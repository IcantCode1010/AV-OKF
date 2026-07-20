import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  getDefaultKnowledgeRoot,
  resolveKnowledgePath,
} from "./knowledge-root.ts";
import {
  getFrontmatterNumberArray,
  getFrontmatterRelations,
  getFrontmatterScalar,
  getFrontmatterStringArray,
  parseOkfMarkdown,
} from "./okf-frontmatter.ts";
import { isAgentReadyOkfMetadata } from "./okf-generic-metadata.ts";
import type { TopicRelation } from "./okf-relation-types.ts";
import { getEmbeddingProvider } from "./embedding-provider.ts";
import {
  createOkfConceptEmbeddingRepository,
  queueOkfConceptEmbeddingByHash,
  type OkfSemanticMatch,
} from "./okf-concept-embedding.ts";
import { hashOkfSource } from "./okf-concept-embedding-content.ts";
import { PROHIBITED_CLARIFICATION_FIELDS } from "./knowledge-profile.ts";

export type OkfBundleEvidence = {
  answerableMetadata: Record<string, string[]>;
  body: string;
  coveredRagChunkIds: string[];
  coverageType: string | null;
  description: string;
  excerpt: string;
  filePath: string;
  matchedTerms: string[];
  matchReason: string;
  matchStrength: "strong" | "medium";
  okfMatchMode?: "lexical" | "vector";
  lifecycleStatus: OkfConceptLifecycleStatus;
  lifecycleWarnings: string[];
  pageEnd: number;
  pageStart: number;
  relations: TopicRelation[];
  reviewStatus: "approved";
  score: number;
  contentHash?: string;
  searchableMetadata?: string;
  sourceFile: string;
  sourcePages: number[];
  sourceType: "okf_bundle";
  title: string;
  type: string;
};

export type OkfNearMissCandidate = {
  answerableMetadata: Record<string, string[]>;
  filePath: string;
  lexicalScore?: number;
  matchReason: string;
  title: string;
  vectorSimilarity?: number;
};

export type MetadataClarificationField = {
  field: string;
  label: string;
  options: string[];
};

export type MetadataClarification = {
  candidateCount: number;
  fields: MetadataClarificationField[];
  question: string;
};

export type OkfBundleRetrievalDiagnostics = {
  metadataClarification?: MetadataClarification;
  nearMissCandidates: OkfNearMissCandidate[];
  qualifiedEvidence: OkfBundleEvidence[];
};

export type OkfConceptLifecycleStatus =
  | "active"
  | "archived"
  | "deleted"
  | "retracted";

export type OkfConceptLifecycleRecord = {
  reason?: string | null;
  status: OkfConceptLifecycleStatus;
};

export type OkfConceptLifecycleLookup = (input: {
  filePath: string;
  knowledgeBundleId: string;
  knowledgeRoot: string;
  workspaceId: string;
}) => Promise<OkfConceptLifecycleRecord | null | undefined>;

export type OkfBundleRetrievalInput = {
  bundleName?: string;
  clarificationFields?: string[];
  knowledgeBundleId: string;
  knowledgeRoot?: string;
  lifecycleLookup?: OkfConceptLifecycleLookup;
  query: string;
  topK?: number;
  workspaceId: string;
  semantic?: {
    enqueueMissing?(candidates: Array<{ contentHash: string; filePath: string }>): Promise<void>;
    getMetadata(): Promise<Array<{ contentHash: string; filePath: string }>>;
    search(input: { candidates: Array<{ contentHash: string; filePath: string }>; query: string; topK: number }): Promise<OkfSemanticMatch[]>;
  };
};

export type OkfBundleFileReadInput = {
  clarificationFields?: string[];
  filePath: string;
  knowledgeBundleId: string;
  knowledgeRoot?: string;
  lifecycleLookup?: OkfConceptLifecycleLookup;
  workspaceId: string;
};

const RESERVED_BUNDLE_FILES = new Set([
  "index.md",
  "log.md",
  "source_manifest.md",
]);
const DEFAULT_TOP_K = 4;
const EXCERPT_MAX_CHARS = 1500;
const MIN_QUALIFIED_SCORE = 8;
const DEFAULT_VECTOR_MIN_SIMILARITY = 0.5;
const NEAR_MISS_SIMILARITY_MARGIN = 0.15;
const NEAR_MISS_TOP_K = 8;
const MAX_CLARIFICATION_FIELDS = 2;
const MAX_CLARIFICATION_OPTIONS = 8;
const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "can",
  "do",
  "does",
  "for",
  "from",
  "how",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "what",
  "when",
  "where",
  "which",
  "with",
]);
const GENERIC_RETRIEVAL_TERMS = new Set([
  "check",
  "checks",
  "document",
  "documents",
  "manual",
  "manuals",
  "procedure",
  "procedures",
  "system",
  "systems",
  "troubleshoot",
  "troubleshooting",
]);

export async function retrieveOkfBundleEvidence(
  input: OkfBundleRetrievalInput,
): Promise<OkfBundleEvidence[]> {
  return (await retrieveOkfBundleEvidenceWithDiagnostics(input)).qualifiedEvidence;
}

export async function retrieveOkfBundleEvidenceWithDiagnostics(
  input: OkfBundleRetrievalInput,
): Promise<OkfBundleRetrievalDiagnostics> {
  const queryTerms = tokenize(input.query);

  if (queryTerms.length === 0) {
    return emptyDiagnostics();
  }

  const trustedCandidates = await listApprovedOkfBundleEvidence(input);
  const lexicalNearMisses: OkfNearMissCandidate[] = [];
  const lexicalCandidates = trustedCandidates.flatMap((candidate) => {
    const evaluation = evaluateCandidate({
      body: candidate.body,
      description: candidate.description,
      metadata: candidate.searchableMetadata ?? "",
      queryTerms,
      title: candidate.title,
    });
    if (!evaluation.qualifies && evaluation.matchedTerms.length > 0) {
      lexicalNearMisses.push(
        toNearMiss(candidate, {
          lexicalScore: evaluation.score,
          matchReason: `Weak lexical match: ${evaluation.matchedTerms.join(", ")}`,
        }),
      );
    }
    return evaluation.qualifies
      ? [{
          ...candidate,
          matchedTerms: evaluation.matchedTerms,
          matchReason: evaluation.reason,
          matchStrength: evaluation.strength,
          okfMatchMode: "lexical" as const,
          score: evaluation.score,
        }]
      : [];
  });

  if (lexicalCandidates.length > 0) {
    return {
      nearMissCandidates: [],
      qualifiedEvidence: sortEvidence(lexicalCandidates).slice(
        0,
        input.topK ?? DEFAULT_TOP_K,
      ),
    };
  }

  const semantic = input.semantic ?? createDefaultSemanticRetriever(input);
  if (!semantic || trustedCandidates.length === 0) {
    return buildWeakDiagnostics(
      lexicalNearMisses,
      input.clarificationFields ?? [],
    );
  }
  const candidateIdentities = trustedCandidates.flatMap(({ contentHash, filePath }) =>
    contentHash ? [{ contentHash, filePath }] : [],
  );
  const metadata = await semantic.getMetadata();
  const current = new Set(metadata.map((row) => `${row.filePath}:${row.contentHash}`));
  const missing = candidateIdentities.filter((row) => !current.has(`${row.filePath}:${row.contentHash}`));
  if (missing.length > 0) await semantic.enqueueMissing?.(missing);
  const eligible = candidateIdentities.filter((row) => current.has(`${row.filePath}:${row.contentHash}`));
  if (eligible.length === 0) {
    return buildWeakDiagnostics(
      lexicalNearMisses,
      input.clarificationFields ?? [],
    );
  }
  const matches = await semantic.search({
    candidates: eligible,
    query: input.query,
    topK: Math.max(input.topK ?? DEFAULT_TOP_K, NEAR_MISS_TOP_K),
  });
  const minimum = readSimilarityThreshold();
  const nearMissMinimum = Math.max(-1, minimum - NEAR_MISS_SIMILARITY_MARGIN);
  const byPath = new Map(trustedCandidates.map((candidate) => [candidate.filePath, candidate]));
  const semanticNearMisses: OkfNearMissCandidate[] = [];
  const qualifiedEvidence = sortEvidence(matches.flatMap((match) => {
    const candidate = byPath.get(match.filePath);
    if (!candidate) return [];
    if (match.score < minimum) {
      if (match.score >= nearMissMinimum) {
        semanticNearMisses.push(
          toNearMiss(candidate, {
            matchReason: `Semantic similarity ${match.score.toFixed(3)} was below the ${minimum.toFixed(2)} evidence threshold.`,
            vectorSimilarity: match.score,
          }),
        );
      }
      return [];
    }
    return [{
      ...candidate,
      matchReason: `Semantic similarity ${match.score.toFixed(3)} met the ${minimum.toFixed(2)} threshold.`,
      matchStrength: match.score >= 0.7 ? "strong" as const : "medium" as const,
      okfMatchMode: "vector" as const,
      score: match.score,
    }];
  })).slice(0, input.topK ?? DEFAULT_TOP_K);
  if (qualifiedEvidence.length > 0) {
    return { nearMissCandidates: [], qualifiedEvidence };
  }
  return buildWeakDiagnostics(
    mergeNearMisses(lexicalNearMisses, semanticNearMisses),
    input.clarificationFields ?? [],
  );
}

export async function listApprovedOkfBundleEvidence(
  input: Pick<
    OkfBundleRetrievalInput,
    | "clarificationFields"
    | "knowledgeBundleId"
    | "knowledgeRoot"
    | "lifecycleLookup"
    | "workspaceId"
  >,
): Promise<OkfBundleEvidence[]> {
  const root = path.resolve(input.knowledgeRoot ?? getDefaultKnowledgeRoot());
  let files: string[];
  try {
    files = await collectMarkdownFiles(root, root);
  } catch (error) {
    if (isMissingDirectoryError(error)) {
      return [];
    }

    throw error;
  }

  const trustedCandidates: OkfBundleEvidence[] = [];

  for (const filePath of files) {
    if (RESERVED_BUNDLE_FILES.has(filePath)) {
      continue;
    }

    const fullPath = await resolveKnowledgePath({
      knowledgeRoot: root,
      relativePath: filePath,
    });
    if (!fullPath) {
      continue;
    }

    const markdown = await readFile(fullPath, "utf8");
    const lifecycle = await resolveLifecycleStatus({
      filePath,
      knowledgeBundleId: input.knowledgeBundleId,
      knowledgeRoot: root,
      lifecycleLookup: input.lifecycleLookup,
      workspaceId: input.workspaceId,
    });

    if (lifecycle.status !== "active") {
      continue;
    }

    const evidence = await buildEvidenceCandidate(
      root,
      filePath,
      markdown,
      null,
      lifecycle.status,
      input.clarificationFields ?? [],
    );

    if (evidence) {
      trustedCandidates.push(evidence);
    }
  }

  return trustedCandidates;
}

function sortEvidence(candidates: OkfBundleEvidence[]) {
  return candidates
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      const titleOrder = left.title.localeCompare(right.title);
      return titleOrder === 0 ? left.filePath.localeCompare(right.filePath) : titleOrder;
    });
}

export async function readOkfBundleEvidenceByPath(
  input: OkfBundleFileReadInput,
): Promise<OkfBundleEvidence | null> {
  const root = path.resolve(input.knowledgeRoot ?? getDefaultKnowledgeRoot());
  const filePath = normalizeBundleFilePath(input.filePath);

  if (!filePath || RESERVED_BUNDLE_FILES.has(filePath)) {
    return null;
  }

  const fullPath = await resolveKnowledgePath({
    knowledgeRoot: root,
    relativePath: filePath,
  });
  if (!fullPath) {
    return null;
  }

  try {
    const markdown = await readFile(fullPath, "utf8");
    const lifecycle = await resolveLifecycleStatus({
      filePath,
      knowledgeBundleId: input.knowledgeBundleId,
      knowledgeRoot: root,
      lifecycleLookup: input.lifecycleLookup,
      workspaceId: input.workspaceId,
    });

    if (lifecycle.status !== "active") {
      return null;
    }

    return buildEvidenceCandidate(
      root,
      filePath,
      markdown,
      null,
      lifecycle.status,
      input.clarificationFields ?? [],
    );
  } catch (error) {
    if (isMissingDirectoryError(error) || isMissingFileError(error)) {
      return null;
    }

    throw error;
  }
}

async function collectMarkdownFiles(root: string, directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectMarkdownFiles(root, entryPath)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(path.relative(root, entryPath).replaceAll(path.sep, "/"));
    }
  }

  return files;
}

async function buildEvidenceCandidate(
  root: string,
  filePath: string,
  markdown: string,
  queryTerms: string[] | null,
  lifecycleStatus: OkfConceptLifecycleStatus,
  clarificationFields: string[],
): Promise<OkfBundleEvidence | null> {
  const parsed = parseOkfMarkdown(markdown);
  const type = getFrontmatterScalar(parsed.frontmatter, "type");
  const title = getFrontmatterScalar(parsed.frontmatter, "title");
  const description = getFrontmatterScalar(parsed.frontmatter, "description");
  const sourceFile = getFrontmatterScalar(parsed.frontmatter, "source_file");
  const sourcePages = getFrontmatterNumberArray(parsed.frontmatter, "source_pages");

  if (!isAgentReadyOkfMetadata(parsed.frontmatter, parsed.body)) {
    return null;
  }

  const trustedTitle = title!;
  const trustedDescription = description ?? "";
  const trustedSourceFile = sourceFile!;
  const answerableMetadata = buildAnswerableMetadata(
    parsed.frontmatter,
    clarificationFields,
  );

  const searchableMetadata = [
    type,
    sourceFile,
    getFrontmatterScalar(parsed.frontmatter, "subject_family"),
    getFrontmatterScalar(parsed.frontmatter, "document_type"),
    getFrontmatterScalar(parsed.frontmatter, "classification_code"),
    getFrontmatterScalar(parsed.frontmatter, "effectivity"),
    getFrontmatterScalar(parsed.frontmatter, "source_authority"),
    getFrontmatterScalar(parsed.frontmatter, "revision"),
    getFrontmatterScalar(parsed.frontmatter, "knowledge_version"),
    getFrontmatterScalar(parsed.frontmatter, "updated"),
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ");
  const match = queryTerms
    ? qualifyCandidate({
        body: parsed.body,
        description: trustedDescription,
        metadata: searchableMetadata,
        queryTerms,
        title: trustedTitle,
      })
    : null;
  if (queryTerms && !match) {
    return null;
  }

  return {
    answerableMetadata,
    body: parsed.body,
    contentHash: hashOkfSource(markdown),
    coveredRagChunkIds: getFrontmatterStringArray(
      parsed.frontmatter,
      "covered_rag_chunk_ids",
    ),
    coverageType: getFrontmatterScalar(parsed.frontmatter, "coverage_type"),
    description: trustedDescription,
    excerpt: truncateExcerpt([trustedDescription, parsed.body].join("\n\n")),
    filePath,
    lifecycleStatus,
    lifecycleWarnings: await buildRelationWarnings(
      root,
      filePath,
      getFrontmatterRelations(parsed.frontmatter),
    ),
    matchedTerms: match?.matchedTerms ?? [],
    matchReason: match?.reason ?? "approved relation target",
    matchStrength: match?.strength ?? "medium",
    pageEnd: Math.max(...sourcePages),
    pageStart: Math.min(...sourcePages),
    relations: getFrontmatterRelations(parsed.frontmatter),
    reviewStatus: "approved",
    score: match?.score ?? 0,
    searchableMetadata,
    sourceFile: trustedSourceFile,
    sourcePages,
    sourceType: "okf_bundle",
    title: trustedTitle,
    type: type!,
  };
}

function emptyDiagnostics(): OkfBundleRetrievalDiagnostics {
  return { nearMissCandidates: [], qualifiedEvidence: [] };
}

function toNearMiss(
  candidate: OkfBundleEvidence,
  match: Pick<OkfNearMissCandidate, "matchReason"> &
    Partial<Pick<OkfNearMissCandidate, "lexicalScore" | "vectorSimilarity">>,
): OkfNearMissCandidate {
  return {
    answerableMetadata: candidate.answerableMetadata,
    filePath: candidate.filePath,
    matchReason: match.matchReason,
    title: candidate.title,
    ...(match.lexicalScore === undefined ? {} : { lexicalScore: match.lexicalScore }),
    ...(match.vectorSimilarity === undefined
      ? {}
      : { vectorSimilarity: match.vectorSimilarity }),
  };
}

function mergeNearMisses(
  lexical: OkfNearMissCandidate[],
  semantic: OkfNearMissCandidate[],
): OkfNearMissCandidate[] {
  const merged = new Map<string, OkfNearMissCandidate>();
  for (const candidate of [...lexical, ...semantic]) {
    const current = merged.get(candidate.filePath);
    merged.set(candidate.filePath, current ? { ...current, ...candidate } : candidate);
  }
  return [...merged.values()];
}

function buildWeakDiagnostics(
  candidates: OkfNearMissCandidate[],
  clarificationFields: string[],
): OkfBundleRetrievalDiagnostics {
  const nearMissCandidates = [...candidates]
    .sort((left, right) => {
      const vectorOrder =
        (right.vectorSimilarity ?? -2) - (left.vectorSimilarity ?? -2);
      if (vectorOrder !== 0) return vectorOrder;
      const lexicalOrder = (right.lexicalScore ?? -1) - (left.lexicalScore ?? -1);
      if (lexicalOrder !== 0) return lexicalOrder;
      const titleOrder = left.title.localeCompare(right.title);
      return titleOrder === 0
        ? left.filePath.localeCompare(right.filePath)
        : titleOrder;
    })
    .slice(0, NEAR_MISS_TOP_K);
  const metadataClarification = deriveMetadataClarification(
    nearMissCandidates,
    clarificationFields,
  );
  return {
    ...(metadataClarification ? { metadataClarification } : {}),
    nearMissCandidates,
    qualifiedEvidence: [],
  };
}

export function deriveMetadataClarification(
  candidates: OkfNearMissCandidate[],
  clarificationFields: string[],
): MetadataClarification | undefined {
  if (candidates.length < 2) return undefined;
  const fields = clarificationFields
    .flatMap((field) => {
      if (PROHIBITED_CLARIFICATION_FIELDS.has(field)) return [];
      const valuesByCandidate = candidates.map(
        (candidate) => candidate.answerableMetadata[field] ?? [],
      );
      if (valuesByCandidate.some((values) => values.length === 0)) return [];
      const options = dedupeDisplayValues(valuesByCandidate.flat());
      if (options.length < 2 || options.length > MAX_CLARIFICATION_OPTIONS) {
        return [];
      }
      const subsets = options.map((option) =>
        candidates
          .filter((candidate) =>
            (candidate.answerableMetadata[field] ?? []).some(
              (value) =>
                value.toLocaleLowerCase() === option.toLocaleLowerCase(),
            ),
          )
          .map((candidate) => candidate.filePath)
          .sort()
          .join("|"),
      );
      if (new Set(subsets).size < 2) return [];
      return [{ field, label: formatFieldLabel(field), options }];
    })
    .slice(0, MAX_CLARIFICATION_FIELDS);
  if (fields.length === 0) return undefined;
  const labels = fields.map((field) => field.label.toLocaleLowerCase());
  const requested = labels.length === 1
    ? labels[0]
    : `${labels[0]} and ${labels[1]}`;
  return {
    candidateCount: candidates.length,
    fields,
    question: `I found several related approved topics that differ by ${requested}. Select the applicable value${fields.length === 1 ? "" : "s"} so I can narrow the search.`,
  };
}

function buildAnswerableMetadata(
  frontmatter: Record<
    string,
    import("./okf-frontmatter.ts").OkfFrontmatterValue
  >,
  clarificationFields: string[],
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const field of clarificationFields) {
    if (PROHIBITED_CLARIFICATION_FIELDS.has(field)) continue;
    const value = frontmatter[field];
    const values = typeof value === "string"
      ? [value]
      : Array.isArray(value) && value.every((item) => typeof item === "string")
        ? value
        : [];
    const normalized = dedupeDisplayValues(values);
    if (normalized.length > 0) result[field] = normalized;
  }
  return result;
}

function dedupeDisplayValues(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const value = raw.trim().replace(/\s+/g, " ");
    const key = value.toLocaleLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function formatFieldLabel(field: string): string {
  if (field === "subject_family") return "Subject or family";
  return field.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

async function resolveLifecycleStatus(input: {
  filePath: string;
  knowledgeBundleId: string;
  knowledgeRoot: string;
  lifecycleLookup?: OkfConceptLifecycleLookup;
  workspaceId: string;
}): Promise<OkfConceptLifecycleRecord> {
  if (!input.lifecycleLookup) {
    return { status: "active" };
  }

  return (
    (await input.lifecycleLookup({
      filePath: input.filePath,
      knowledgeBundleId: input.knowledgeBundleId,
      knowledgeRoot: input.knowledgeRoot,
      workspaceId: input.workspaceId,
    })) ?? { status: "active" }
  );
}

function createDefaultSemanticRetriever(input: OkfBundleRetrievalInput) {
  if (process.env.AV_OKF_BACKEND !== "production") return null;
  const repository = createOkfConceptEmbeddingRepository();
  return {
    async enqueueMissing(candidates: Array<{ contentHash: string; filePath: string }>) {
      for (const candidate of candidates) {
        await queueOkfConceptEmbeddingByHash({
          bundleName: input.bundleName ?? "Knowledge Bundle",
          ...candidate,
          knowledgeBundleId: input.knowledgeBundleId,
          repository,
          workspaceId: input.workspaceId,
        });
      }
    },
    getMetadata: () => repository.getEmbeddingMetadata(input),
    async search(searchInput: { candidates: Array<{ contentHash: string; filePath: string }>; query: string; topK: number }) {
      const provider = getEmbeddingProvider();
      const [embedding] = await provider.embedTexts([searchInput.query]);
      if (!embedding) return [];
      return repository.search({ ...searchInput, embedding, knowledgeBundleId: input.knowledgeBundleId, workspaceId: input.workspaceId });
    },
  };
}

function readSimilarityThreshold() {
  const value = Number(process.env.OKF_VECTOR_MIN_SIMILARITY ?? DEFAULT_VECTOR_MIN_SIMILARITY);
  if (!Number.isFinite(value) || value < -1 || value > 1) throw new Error("invalid_env_OKF_VECTOR_MIN_SIMILARITY");
  return value;
}

function normalizeBundleFilePath(value: string): string | null {
  const normalized = path.posix.normalize(value.trim().replaceAll("\\", "/"));
  if (
    !normalized ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("/") ||
    normalized.startsWith("../")
  ) {
    return null;
  }

  return normalized;
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT",
  );
}

async function buildRelationWarnings(
  root: string,
  filePath: string,
  relations: TopicRelation[],
): Promise<string[]> {
  const warnings: string[] = [];

  for (let index = 0; index < relations.length; index += 1) {
    const relation = relations[index]!;
    const target = relation.target.trim();

    if (!target || !target.endsWith(".md") || target.includes("\\")) {
      warnings.push(`relation_target_invalid:${index}:${relation.target}`);
      continue;
    }

    const targetPath = await resolveKnowledgePath({
      basePath: path.resolve(root, path.dirname(filePath)),
      knowledgeRoot: root,
      relativePath: target,
    });

    if (!targetPath) {
      warnings.push(`relation_target_invalid:${index}:${relation.target}`);
      continue;
    }

    try {
      await access(targetPath);
    } catch {
      warnings.push(`relation_target_missing:${index}:${relation.target}`);
    }
  }

  return warnings;
}

type CandidateEvaluation = {
  matchedTerms: string[];
  qualifies: boolean;
  reason: string;
  score: number;
  strength: "strong" | "medium";
};

function qualifyCandidate(input: {
  body: string;
  description: string;
  metadata: string;
  queryTerms: string[];
  title: string;
}): Omit<CandidateEvaluation, "qualifies"> | null {
  const evaluation = evaluateCandidate(input);
  if (!evaluation.qualifies) return null;
  return {
    matchedTerms: evaluation.matchedTerms,
    reason: evaluation.reason,
    score: evaluation.score,
    strength: evaluation.strength,
  };
}

function evaluateCandidate(input: {
  body: string;
  description: string;
  metadata: string;
  queryTerms: string[];
  title: string;
}): CandidateEvaluation {
  const titleTokens = tokenizeField(input.title);
  const descriptionTokens = tokenizeField(input.description);
  const metadataTokens = tokenizeField(input.metadata);
  const bodyTokens = tokenizeField(input.body);
  const titleSet = new Set(titleTokens);
  const descriptionSet = new Set(descriptionTokens);
  const metadataSet = new Set(metadataTokens);
  const bodySet = new Set(bodyTokens);
  const queryPhrase = input.queryTerms.join(" ");
  const titlePhrase = titleTokens.join(" ");
  const descriptionPhrase = descriptionTokens.join(" ");
  const metadataPhrase = metadataTokens.join(" ");
  const bodyPhrase = bodyTokens.join(" ");
  const titleMatches = matchingTerms(input.queryTerms, titleSet);
  const descriptionMatches = matchingTerms(input.queryTerms, descriptionSet);
  const metadataMatches = matchingTerms(input.queryTerms, metadataSet);
  const bodyMatches = matchingTerms(input.queryTerms, bodySet);
  const qualifyingTerms = uniqueTerms([
    ...titleMatches,
    ...descriptionMatches,
    ...metadataMatches,
  ]);
  const exactTitlePhrase =
    queryPhrase.length > 0 && phraseIncludes(titlePhrase, queryPhrase);
  const exactDescriptionPhrase =
    queryPhrase.length > 0 && phraseIncludes(descriptionPhrase, queryPhrase);
  const exactMetadataPhrase =
    queryPhrase.length > 0 && phraseIncludes(metadataPhrase, queryPhrase);
  const exactBodyPhrase =
    queryPhrase.length > 0 && phraseIncludes(bodyPhrase, queryPhrase);
  const hasExactQualifyingPhrase =
    exactTitlePhrase || exactDescriptionPhrase || exactMetadataPhrase;
  const hasEnoughQualifyingTerms =
    input.queryTerms.length <= 2
      ? qualifyingTerms.length >= 1
      : qualifyingTerms.length >= 2;

  let score = 0;
  if (exactTitlePhrase) {
    score += 100;
  }
  if (exactDescriptionPhrase) {
    score += 50;
  }
  if (exactMetadataPhrase) {
    score += 30;
  }
  if (exactBodyPhrase) {
    score += 10;
  }

  for (const term of input.queryTerms) {
    if (titleSet.has(term)) {
      score += 20;
    }
    if (descriptionSet.has(term)) {
      score += 8;
    }
    if (metadataSet.has(term)) {
      score += 5;
    }
    if (bodySet.has(term)) {
      score += 1;
    }
  }

  const matchedTerms = uniqueTerms([...qualifyingTerms, ...bodyMatches]);
  const strength =
    (hasExactQualifyingPhrase && input.queryTerms.length > 1) ||
    titleMatches.length >= 2
      ? "strong"
      : "medium";

  return {
    matchedTerms,
    qualifies:
      (hasExactQualifyingPhrase || hasEnoughQualifyingTerms) &&
      score >= MIN_QUALIFIED_SCORE,
    reason: matchReason({
      exactDescriptionPhrase,
      exactMetadataPhrase,
      exactTitlePhrase,
      qualifyingTerms,
      strength,
      titleMatches,
    }),
    score,
    strength,
  };
}

function tokenize(query: string): string[] {
  return uniqueTerms(
    tokenizeField(query).filter(
      (term) => !STOPWORDS.has(term) && !GENERIC_RETRIEVAL_TERMS.has(term),
    ),
  );
}

function tokenizeField(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((term) => term.length > 1);
}

function matchingTerms(queryTerms: string[], targetTerms: Set<string>): string[] {
  return queryTerms.filter((term) => targetTerms.has(term));
}

function uniqueTerms(terms: string[]): string[] {
  return Array.from(new Set(terms));
}

function phraseIncludes(targetPhrase: string, queryPhrase: string): boolean {
  return ` ${targetPhrase} `.includes(` ${queryPhrase} `);
}

function matchReason(input: {
  exactDescriptionPhrase: boolean;
  exactMetadataPhrase: boolean;
  exactTitlePhrase: boolean;
  qualifyingTerms: string[];
  strength: "strong" | "medium";
  titleMatches: string[];
}): string {
  if (input.exactTitlePhrase) {
    return `${input.strength} title phrase match`;
  }

  if (input.exactDescriptionPhrase) {
    return "strong description phrase match";
  }

  if (input.exactMetadataPhrase) {
    return "strong source metadata phrase match";
  }

  if (input.exactTitlePhrase || input.titleMatches.length > 0) {
    return `${input.strength} title term match: ${input.titleMatches.join(", ")}`;
  }

  return `${input.strength} qualifying term match: ${input.qualifyingTerms.join(", ")}`;
}

function truncateExcerpt(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > EXCERPT_MAX_CHARS
    ? `${normalized.slice(0, EXCERPT_MAX_CHARS - 3).trimEnd()}...`
    : normalized;
}

function isMissingDirectoryError(error: unknown) {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

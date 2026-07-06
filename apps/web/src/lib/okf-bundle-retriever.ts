import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { getDefaultKnowledgeRoot } from "./knowledge-root.ts";
import {
  getFrontmatterNumberArray,
  getFrontmatterRelations,
  getFrontmatterScalar,
  getFrontmatterStringArray,
  parseOkfMarkdown,
} from "./okf-frontmatter.ts";
import type { TopicRelation } from "./okf-relations.ts";

export type OkfBundleEvidence = {
  body: string;
  coveredRagChunkIds: string[];
  coverageType: string | null;
  description: string;
  excerpt: string;
  filePath: string;
  matchedTerms: string[];
  matchReason: string;
  matchStrength: "strong" | "medium";
  pageEnd: number;
  pageStart: number;
  relations: TopicRelation[];
  reviewStatus: "approved";
  score: number;
  sourceFile: string;
  sourcePages: number[];
  sourceType: "okf_bundle";
  title: string;
  type: string;
};

export type OkfBundleRetrievalInput = {
  knowledgeRoot?: string;
  query: string;
  topK?: number;
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
  const root = path.resolve(input.knowledgeRoot ?? getDefaultKnowledgeRoot());
  const queryTerms = tokenize(input.query);

  if (queryTerms.length === 0) {
    return [];
  }

  let files: string[];
  try {
    files = await collectMarkdownFiles(root, root);
  } catch (error) {
    if (isMissingDirectoryError(error)) {
      return [];
    }

    throw error;
  }

  const candidates: OkfBundleEvidence[] = [];

  for (const filePath of files) {
    if (RESERVED_BUNDLE_FILES.has(filePath)) {
      continue;
    }

    const fullPath = path.resolve(root, filePath);
    if (fullPath !== root && !fullPath.startsWith(`${root}${path.sep}`)) {
      continue;
    }

    const markdown = await readFile(fullPath, "utf8");
    const evidence = buildEvidenceCandidate(filePath, markdown, queryTerms);

    if (evidence && evidence.score > 0) {
      candidates.push(evidence);
    }
  }

  return candidates
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      const titleOrder = left.title.localeCompare(right.title);
      return titleOrder === 0 ? left.filePath.localeCompare(right.filePath) : titleOrder;
    })
    .slice(0, input.topK ?? DEFAULT_TOP_K);
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

function buildEvidenceCandidate(
  filePath: string,
  markdown: string,
  queryTerms: string[],
): OkfBundleEvidence | null {
  const parsed = parseOkfMarkdown(markdown);
  const type = getFrontmatterScalar(parsed.frontmatter, "type");
  const reviewStatus = getFrontmatterScalar(parsed.frontmatter, "review_status");
  const title = getFrontmatterScalar(parsed.frontmatter, "title");
  const description = getFrontmatterScalar(parsed.frontmatter, "description");
  const sourceFile = getFrontmatterScalar(parsed.frontmatter, "source_file");
  const sourcePages = getFrontmatterNumberArray(parsed.frontmatter, "source_pages");

  if (
    !type ||
    reviewStatus !== "approved" ||
    !title ||
    !description ||
    !sourceFile ||
    sourcePages.length === 0
  ) {
    return null;
  }

  const searchableMetadata = [
    type,
    sourceFile,
    getFrontmatterScalar(parsed.frontmatter, "aircraft_family"),
    getFrontmatterScalar(parsed.frontmatter, "manual_type"),
    getFrontmatterScalar(parsed.frontmatter, "ata"),
    getFrontmatterScalar(parsed.frontmatter, "effectivity"),
    getFrontmatterScalar(parsed.frontmatter, "source_authority"),
    getFrontmatterScalar(parsed.frontmatter, "revision"),
    getFrontmatterScalar(parsed.frontmatter, "knowledge_version"),
    getFrontmatterScalar(parsed.frontmatter, "last_verified"),
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ");
  const match = qualifyCandidate({
    body: parsed.body,
    description,
    metadata: searchableMetadata,
    queryTerms,
    title,
  });
  if (!match) {
    return null;
  }

  return {
    body: parsed.body,
    coveredRagChunkIds: getFrontmatterStringArray(
      parsed.frontmatter,
      "covered_rag_chunk_ids",
    ),
    coverageType: getFrontmatterScalar(parsed.frontmatter, "coverage_type"),
    description,
    excerpt: truncateExcerpt([description, parsed.body].join("\n\n")),
    filePath,
    matchedTerms: match.matchedTerms,
    matchReason: match.reason,
    matchStrength: match.strength,
    pageEnd: Math.max(...sourcePages),
    pageStart: Math.min(...sourcePages),
    relations: getFrontmatterRelations(parsed.frontmatter),
    reviewStatus: "approved",
    score: match.score,
    sourceFile,
    sourcePages,
    sourceType: "okf_bundle",
    title,
    type,
  };
}

function qualifyCandidate(input: {
  body: string;
  description: string;
  metadata: string;
  queryTerms: string[];
  title: string;
}): {
  matchedTerms: string[];
  reason: string;
  score: number;
  strength: "strong" | "medium";
} | null {
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

  if (!hasExactQualifyingPhrase && !hasEnoughQualifyingTerms) {
    return null;
  }

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

  if (score < MIN_QUALIFIED_SCORE) {
    return null;
  }

  const matchedTerms = uniqueTerms([...qualifyingTerms, ...bodyMatches]);
  const strength =
    (hasExactQualifyingPhrase && input.queryTerms.length > 1) ||
    titleMatches.length >= 2
      ? "strong"
      : "medium";

  return {
    matchedTerms,
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

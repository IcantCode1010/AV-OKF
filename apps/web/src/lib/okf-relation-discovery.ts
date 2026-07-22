import { readFile } from "node:fs/promises";
import path from "node:path";

import { getFrontmatterNumberArray, getFrontmatterScalar, getFrontmatterStringArray, parseOkfMarkdown } from "./okf-frontmatter.ts";
import { isAgentReadyOkfMetadata } from "./okf-generic-metadata.ts";
import { getKnowledgeBundleByIdentity, resolveKnowledgeBundleRoot } from "./knowledge-bundles.ts";
import { getPrisma } from "./prisma.ts";
import {
  loadOkfRelationPreflightContext,
  preflightOkfRelationCandidate,
  relationPreflightSignal,
  type OkfRelationPreflightContext,
} from "./okf-relation-preflight.ts";

const BASE_STOPWORDS = new Set([
  "and",
  "are",
  "for",
  "from",
  "into",
  "that",
  "the",
  "these",
  "this",
  "those",
  "using",
  "was",
  "were",
  "with",
]);

export type RelationDiscoveryConcept = {
  filePath: string;
  pages: number[];
  sourceFile: string;
  tags: string[];
  terms: string[];
};

export type RelationDiscoveryCandidate = {
  reason: string;
  relation: string;
  signals: string[];
  sourceFile: string;
  targetFile: string;
};

export type RelationDiscoverySuppression = {
  candidate: RelationDiscoveryCandidate;
  issues: Array<{ code: string; severity: "error" | "warning" }>;
};

export async function discoverOkfRelationCandidates(input: { knowledgeBundleId: string; workspaceId: string }) {
  const bundle = await getKnowledgeBundleByIdentity({ bundleId: input.knowledgeBundleId, workspaceId: input.workspaceId });
  if (!bundle) throw new Error("knowledge_bundle_not_found");
  const concepts = await loadRelationDiscoveryConcepts(input);

  const discoveredCandidates = buildDeterministicRelationCandidates(concepts, {
    stopwords: bundle.profile.relationDiscovery.stopwords,
  });
  const context = await loadOkfRelationPreflightContext({
    knowledgeBundleId: bundle.id,
    workspaceId: input.workspaceId,
  });
  const candidates = [];
  let suppressed = 0;
  let warningCount = 0;
  for (const candidate of discoveredCandidates) {
    const preflight = preflightOkfRelationCandidate({
      ...context,
      candidate: { ...candidate, reason: candidate.reason },
    });
    if (!preflight.accepted) {
      suppressed += 1;
      continue;
    }
    const warnings = preflight.issues.filter((issue) => issue.severity === "warning");
    warningCount += warnings.length;
    candidates.push({
      ...candidate,
      knowledgeBundleId: bundle.id,
      signals: [...candidate.signals, ...warnings.map(relationPreflightSignal)],
      workspaceId: input.workspaceId,
    });
    context.existingEdges.push(candidate);
  }
  if (candidates.length > 0) await getPrisma().okfRelationCandidate.createMany({ data: candidates, skipDuplicates: true });
  return { discovered: candidates.length, suppressed, warnings: warningCount };
}

export function buildDeterministicRelationCandidates(
  concepts: RelationDiscoveryConcept[],
  options: { stopwords?: string[] } = {},
): RelationDiscoveryCandidate[] {
  const candidates: RelationDiscoveryCandidate[] = [];
  const stopwords = new Set([...BASE_STOPWORDS, ...(options.stopwords ?? []).map(normalizeTerm)]);
  const orderedConcepts = [...concepts].sort((left, right) =>
    left.filePath.localeCompare(right.filePath),
  );
  for (let leftIndex = 0; leftIndex < orderedConcepts.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < orderedConcepts.length; rightIndex += 1) {
      const left = orderedConcepts[leftIndex]!;
      const right = orderedConcepts[rightIndex]!;
      const qualifyingSignals: string[] = [];
      const matchedTags = intersection(left.tags, right.tags);
      const matchedTerms = intersection(
        left.terms.filter((term) => !stopwords.has(normalizeTerm(term))),
        right.terms.filter((term) => !stopwords.has(normalizeTerm(term))),
      );
      if (left.sourceFile && left.sourceFile === right.sourceFile) qualifyingSignals.push("shared_source_file");
      if (matchedTags.length > 0) qualifyingSignals.push("shared_tags");
      if (matchedTerms.length >= 2) qualifyingSignals.push("title_description_overlap");
      if (left.sourceFile === right.sourceFile && pageDistance(left.pages, right.pages) <= 3) qualifyingSignals.push("source_page_proximity");
      if (qualifyingSignals.length < 2) continue;
      const signals = [
        ...qualifyingSignals,
        ...matchedTerms.map((term) => `matched_term:${term}`),
        ...matchedTags.map((tag) => `matched_tag:${tag}`),
      ];
      candidates.push({
        reason: buildCandidateReason({ matchedTags, matchedTerms, qualifyingSignals }),
        relation: qualifyingSignals.includes("source_page_proximity") ? "supports" : "references",
        signals,
        sourceFile: left.filePath,
        targetFile: right.filePath,
      });
    }
  }
  return candidates;
}

export function buildLegacyRelationCandidatesForEvaluation(
  concepts: RelationDiscoveryConcept[],
): RelationDiscoveryCandidate[] {
  const candidates: RelationDiscoveryCandidate[] = [];
  for (let leftIndex = 0; leftIndex < concepts.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < concepts.length; rightIndex += 1) {
      const left = concepts[leftIndex]!;
      const right = concepts[rightIndex]!;
      const signals: string[] = [];
      if (left.sourceFile && left.sourceFile === right.sourceFile) signals.push("shared_source_file");
      if (intersection(left.tags, right.tags).length > 0) signals.push("shared_tags");
      if (intersection(left.terms, right.terms).length > 0) signals.push("title_description_overlap");
      if (left.sourceFile === right.sourceFile && pageDistance(left.pages, right.pages) <= 3) signals.push("source_page_proximity");
      if (signals.length < 2) continue;
      candidates.push({
        reason: `Discovered from ${signals.join(", ")}.`,
        relation: signals.includes("source_page_proximity") ? "supports" : "references",
        signals,
        sourceFile: left.filePath,
        targetFile: right.filePath,
      });
    }
  }
  return candidates;
}

export async function evaluateOkfRelationDiscovery(input: {
  knowledgeBundleId: string;
  workspaceId: string;
}) {
  const bundle = await getKnowledgeBundleByIdentity({ bundleId: input.knowledgeBundleId, workspaceId: input.workspaceId });
  if (!bundle) throw new Error("knowledge_bundle_not_found");
  const concepts = await loadRelationDiscoveryConcepts(input);
  const context = await loadOkfRelationPreflightContext(input);
  const evaluation = evaluateRelationDiscoveryCandidates({
    concepts,
    context,
    stopwords: bundle.profile.relationDiscovery.stopwords,
  });
  return {
    ...evaluation,
    bundle: { id: bundle.id, name: bundle.name, profileId: bundle.profile.id },
    conceptCount: concepts.length,
  };
}

export function evaluateRelationDiscoveryCandidates(input: {
  concepts: RelationDiscoveryConcept[];
  context: OkfRelationPreflightContext;
  stopwords: string[];
}) {
  const legacy = buildLegacyRelationCandidatesForEvaluation(input.concepts);
  const proposed = buildDeterministicRelationCandidates(input.concepts, {
    stopwords: input.stopwords,
  });
  const proposedKeys = new Set(proposed.map(candidateIdentity));
  const qualityFiltered = legacy
    .filter((candidate) => !proposedKeys.has(candidateIdentity(candidate)))
    .map((candidate) => ({
      candidate,
      reason: "v2_meaningful_term_or_signal_gate",
    }));
  const context = {
    activeFiles: [...input.context.activeFiles],
    allowedRelations: [...input.context.allowedRelations],
    existingEdges: [...input.context.existingEdges],
  };
  const accepted: RelationDiscoveryCandidate[] = [];
  const suppressed: RelationDiscoverySuppression[] = [];
  for (const candidate of proposed) {
    const preflight = preflightOkfRelationCandidate({
      ...context,
      candidate: { ...candidate, reason: candidate.reason },
    });
    if (!preflight.accepted) {
      suppressed.push({
        candidate,
        issues: preflight.issues.map(({ code, severity }) => ({ code, severity })),
      });
      continue;
    }
    accepted.push({
      ...candidate,
      signals: [
        ...candidate.signals,
        ...preflight.issues.filter((issue) => issue.severity === "warning").map(relationPreflightSignal),
      ],
    });
    context.existingEdges.push(candidate);
  }
  return {
    after: { accepted, proposedCount: proposed.length, qualityFiltered, suppressed },
    before: { candidates: legacy, candidateCount: legacy.length },
  };
}

export async function loadRelationDiscoveryConcepts(input: {
  knowledgeBundleId: string;
  workspaceId: string;
}): Promise<RelationDiscoveryConcept[]> {
  const bundle = await getKnowledgeBundleByIdentity({ bundleId: input.knowledgeBundleId, workspaceId: input.workspaceId });
  if (!bundle) throw new Error("knowledge_bundle_not_found");
  const root = resolveKnowledgeBundleRoot({ bundleId: bundle.id, workspaceId: input.workspaceId });
  const topics = await getPrisma().topicRecord.findMany({
    orderBy: [{ exportedFilePath: "asc" }, { id: "asc" }],
    where: { knowledgeBundleId: bundle.id, reviewStatus: "approved", exportedFilePath: { not: null }, workspaceId: input.workspaceId },
  });
  const concepts: RelationDiscoveryConcept[] = [];
  for (const topic of topics) {
    const filePath = topic.exportedFilePath!;
    const markdown = await readFile(path.join(root, filePath), "utf8").catch(() => null);
    if (!markdown) continue;
    const parsed = parseOkfMarkdown(markdown);
    if (!isAgentReadyOkfMetadata(parsed.frontmatter, parsed.body)) continue;
    concepts.push({
      filePath,
      pages: getFrontmatterNumberArray(parsed.frontmatter, "source_pages"),
      sourceFile: getFrontmatterScalar(parsed.frontmatter, "source_file") ?? "",
      tags: getFrontmatterStringArray(parsed.frontmatter, "tags"),
      terms: tokenizeRelationTerms(`${getFrontmatterScalar(parsed.frontmatter, "title") ?? ""} ${getFrontmatterScalar(parsed.frontmatter, "description") ?? ""}`),
    });
  }
  return concepts;
}

export async function listOkfRelationCandidates(input: { knowledgeBundleId: string; workspaceId: string }) {
  return getPrisma().okfRelationCandidate.findMany({
    orderBy: [{ status: "asc" }, { sourceFile: "asc" }, { targetFile: "asc" }],
    where: { knowledgeBundleId: input.knowledgeBundleId, workspaceId: input.workspaceId },
  });
}

export function tokenizeRelationTerms(value: string) {
  return [...new Set(
    value
      .normalize("NFKC")
      .toLowerCase()
      .match(/[a-z0-9][a-z0-9_-]{2,}/g)
      ?.map(normalizeTerm)
      .filter((term) => !BASE_STOPWORDS.has(term)) ?? [],
  )].sort((left, right) => left.localeCompare(right));
}

function intersection(left: string[], right: string[]) {
  const rightTerms = new Set(right.map(normalizeTerm));
  return [...new Set(left.map(normalizeTerm).filter((value) => rightTerms.has(value)))]
    .filter(Boolean)
    .sort((first, second) => first.localeCompare(second));
}

function normalizeTerm(value: string) {
  return value.normalize("NFKC").trim().toLowerCase();
}

function buildCandidateReason(input: {
  matchedTags: string[];
  matchedTerms: string[];
  qualifyingSignals: string[];
}) {
  const details = input.qualifyingSignals.map((signal) => {
    if (signal === "shared_tags") return `shared tags (${input.matchedTags.join(", ")})`;
    if (signal === "title_description_overlap") {
      return `title/description terms (${input.matchedTerms.join(", ")})`;
    }
    return signal.replaceAll("_", " ");
  });
  return `Discovered from ${details.join(", ")}.`;
}

function candidateIdentity(candidate: RelationDiscoveryCandidate) {
  return `${candidate.sourceFile}\u0000${candidate.targetFile}\u0000${candidate.relation}`;
}

function pageDistance(left: number[], right: number[]) { return Math.min(...left.flatMap((a) => right.map((b) => Math.abs(a - b))), Number.POSITIVE_INFINITY); }

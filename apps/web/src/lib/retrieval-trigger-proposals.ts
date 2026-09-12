import { createHash } from "node:crypto";

export type RetrievalTriggerCandidate = {
  contentHash: string;
  filePath: string;
  knowledgeBundleId: string;
  matchReason: string;
  suggestedTerms: string[];
  title: string;
};

export type RetrievalTriggerNearMiss = {
  answerableMetadata: Record<string, string[]>;
  contentHash?: string;
  filePath: string;
  matchReason: string;
  title: string;
};

const MAX_CANDIDATES = 3;
const MAX_TERMS = 6;
const MAX_TERM_LENGTH = 80;

export function deriveRetrievalTriggerCandidates(input: {
  knowledgeBundleId: string;
  nearMissCandidates: RetrievalTriggerNearMiss[];
  queryTerms: string[];
}): RetrievalTriggerCandidate[] {
  return input.nearMissCandidates.flatMap((candidate) => {
    if (!candidate.contentHash) return [];
    const existing = new Set(normalizeSearchTokens([
      candidate.title,
      ...Object.values(candidate.answerableMetadata).flat(),
    ]));
    const suggestedTerms = normalizeRetrievalTriggerTerms(input.queryTerms)
      .filter((term) => !existing.has(term))
      .slice(0, MAX_TERMS);
    if (suggestedTerms.length === 0) return [];
    return [{
      contentHash: candidate.contentHash,
      filePath: candidate.filePath,
      knowledgeBundleId: input.knowledgeBundleId,
      matchReason: candidate.matchReason,
      suggestedTerms,
      title: candidate.title,
    }];
  }).slice(0, MAX_CANDIDATES);
}

export function normalizeRetrievalTriggerTerms(values: string[]): string[] {
  return [...new Set(values.flatMap((value) =>
    value
      .normalize("NFKC")
      .toLowerCase()
      .split(",")
      .map((term) => term.replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim())
      .filter((term) => term.length > 1 && term.length <= MAX_TERM_LENGTH)
  ))].sort((left, right) => left.localeCompare(right)).slice(0, MAX_TERMS);
}

export function retrievalTriggerProposalFingerprint(input: {
  contentHash: string;
  filePath: string;
  knowledgeBundleId: string;
  terms: string[];
}) {
  return createHash("sha256").update(JSON.stringify({
    contentHash: input.contentHash,
    filePath: input.filePath,
    knowledgeBundleId: input.knowledgeBundleId,
    terms: normalizeRetrievalTriggerTerms(input.terms),
  })).digest("hex");
}

function normalizeSearchTokens(values: string[]) {
  return values.flatMap((value) =>
    value
      .normalize("NFKC")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
  );
}

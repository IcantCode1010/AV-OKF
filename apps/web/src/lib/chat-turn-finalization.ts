import { parseCitationMarkers } from "./chat-citation-markers.ts";
import type {
  ChatEntityCandidate,
  ChatEvidenceStatus,
} from "./chat-router.ts";
import type {
  ChatCitation,
  ChatRelatedEvidence,
} from "./chat-types.ts";
import type { EvidenceSufficiency } from "./chat-evidence-sufficiency.ts";

export type FinalizedChatTurn = {
  citations: ChatCitation[];
  citationProjection: {
    citedCount: number;
    relatedCount: number;
    remapped: boolean;
    retrievedCount: number;
  };
  content: string;
  entityCandidates?: ChatEntityCandidate[];
  finalEvidenceStatus: ChatEvidenceStatus;
  finalSufficiency: EvidenceSufficiency;
  relatedEvidence: ChatRelatedEvidence[];
};

export function finalizeChatTurn(input: {
  citations: ChatCitation[];
  content: string;
  entityCandidates?: ChatEntityCandidate[];
  outcome?: "answered" | "insufficient_evidence" | "retrieval_unavailable";
  retrievalError?: boolean;
}): FinalizedChatTurn {
  const citedIndexes = input.outcome === "insufficient_evidence"
    ? []
    : uniqueCitationIndexes(input.content, input.citations);
  const indexMap = new Map<number, number>(
    citedIndexes.map((index, position) => [index, position + 1]),
  );
  const citations = citedIndexes.map((index, position) => ({
    ...input.citations.find((citation) => citation.index === index)!,
    index: position + 1,
  }));
  const relatedEvidence = input.citations
    .filter((citation) => !indexMap.has(citation.index))
    .map(({ index, ...citation }) => ({
      ...citation,
      rank: index,
      reason: input.outcome === "insufficient_evidence"
        ? "related_not_answering" as const
        : "retrieved_not_cited" as const,
    }));
  const content = rewriteCitationMarkers(input.content, indexMap);
  const entityCandidates = remapEntityCandidates(
    input.entityCandidates,
    indexMap,
  );
  const finalEvidenceStatus = resolveFinalEvidenceStatus({
    citations,
    outcome: input.outcome,
    retrievalError: input.retrievalError === true,
  });

  return {
    citations,
    citationProjection: {
      citedCount: citations.length,
      relatedCount: relatedEvidence.length,
      remapped: [...indexMap].some(([from, to]) => from !== to),
      retrievedCount: input.citations.length,
    },
    content,
    ...(entityCandidates?.length ? { entityCandidates } : {}),
    finalEvidenceStatus,
    finalSufficiency: resolveFinalSufficiency({
      citations,
      outcome: input.outcome,
      relatedCount: relatedEvidence.length,
      retrievalError: input.retrievalError === true,
    }),
    relatedEvidence,
  };
}

function uniqueCitationIndexes(content: string, citations: ChatCitation[]) {
  const available = new Set(citations.map((citation) => citation.index));
  const seen = new Set<number>();
  return parseCitationMarkers(content)
    .filter((segment) => segment.type === "citation")
    .map((segment) => segment.index)
    .filter((index) => available.has(index) && !seen.has(index) && seen.add(index));
}

function rewriteCitationMarkers(content: string, indexMap: Map<number, number>) {
  return parseCitationMarkers(content)
    .map((segment) => segment.type === "text"
      ? segment.value
      : `[${indexMap.get(segment.index) ?? segment.index}]`)
    .join("");
}

function remapEntityCandidates(
  candidates: ChatEntityCandidate[] | undefined,
  indexMap: Map<number, number>,
) {
  return candidates
    ?.filter((candidate) => indexMap.has(candidate.citationIndex))
    .map((candidate) => ({
      ...candidate,
      citationIndex: indexMap.get(candidate.citationIndex)!,
    }));
}

function resolveFinalEvidenceStatus(input: {
  citations: ChatCitation[];
  outcome?: string;
  retrievalError: boolean;
}): ChatEvidenceStatus {
  if (input.retrievalError) return "retrieval_error";
  if (input.outcome === "insufficient_evidence" || input.citations.length === 0) {
    return "no_evidence";
  }
  return input.citations.some((citation) => citation.sourceType === "okf")
    ? "approved_evidence"
    : "discovery_evidence";
}

function resolveFinalSufficiency(input: {
  citations: ChatCitation[];
  outcome?: string;
  relatedCount: number;
  retrievalError: boolean;
}): EvidenceSufficiency {
  if (input.retrievalError) {
    return { reason: "retrieval_unavailable", status: "none" };
  }
  if (input.outcome === "insufficient_evidence") {
    return input.relatedCount > 0
      ? { reason: "related_evidence_not_answering", status: "weak" }
      : { reason: "no_supported_evidence_found", status: "none" };
  }
  if (input.citations.some((citation) => citation.sourceType === "okf")) {
    if (input.citations.some((citation) => citation.sourceType === "rag")) {
      return {
        namedGap: "raw supporting context remains unreviewed",
        status: "partial",
      };
    }
    return { status: "strong" };
  }
  if (input.citations.length > 0) {
    return { reason: "raw_discovery_evidence_only", status: "weak" };
  }
  return { reason: "no_supported_evidence_found", status: "none" };
}

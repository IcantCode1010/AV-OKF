import type {
  ChatAnswerEvidenceProfile,
  Stage6aRouterTrace,
} from "./chat-router.ts";
import type { ChatCitation } from "./chat-types.ts";

export function buildAnswerEvidenceProfile(input: {
  citations: ChatCitation[];
  trace?: Partial<Stage6aRouterTrace> | null;
}): ChatAnswerEvidenceProfile {
  const okfCount = input.citations.filter(
    (citation) => citation.sourceType === "okf",
  ).length;
  const ragCount = input.citations.filter(
    (citation) => citation.sourceType === "rag",
  ).length;
  const total = input.citations.length;
  const sourceCounts = { okf: okfCount, rag: ragCount, total };

  if (okfCount > 0 && ragCount > 0) {
    return {
      evidenceKind: "mixed",
      evidenceUsed: ["okf", "rag"],
      requiresUserVerification: true,
      sourceCounts,
      trustLevel: "medium",
    };
  }

  if (okfCount > 0) {
    return {
      evidenceKind: "approved_okf",
      evidenceUsed: ["okf"],
      requiresUserVerification: false,
      sourceCounts,
      trustLevel: "high",
    };
  }

  if (ragCount > 0) {
    return {
      evidenceKind: "raw_rag",
      evidenceUsed: ["rag"],
      fallbackReason: rawRagFallbackReason(input.trace),
      requiresUserVerification: true,
      sourceCounts,
      trustLevel: "medium",
    };
  }

  return {
    evidenceKind: "none",
    evidenceUsed: [],
    fallbackReason: noEvidenceFallbackReason(input.trace),
    requiresUserVerification: true,
    sourceCounts,
    trustLevel: "blocked",
  };
}

function rawRagFallbackReason(
  trace?: Partial<Stage6aRouterTrace> | null,
): string | undefined {
  if (
    trace?.ragUsedForDiscoveryOnly ||
    trace?.route === "okf_only" ||
    trace?.route === "hybrid"
  ) {
    return "No approved OKF topic matched. Answered from raw document evidence instead.";
  }

  return undefined;
}

function noEvidenceFallbackReason(
  trace?: Partial<Stage6aRouterTrace> | null,
): string {
  if (trace?.finalEvidenceStatus === "retrieval_error") {
    return "Retrieval was unavailable, so no supporting evidence could be verified.";
  }

  if (trace?.route === "okf_only") {
    return "No approved OKF topics matched this question.";
  }

  if (trace?.route === "rag_only") {
    return "No raw document chunks matched this question.";
  }

  if (trace?.route === "hybrid") {
    return "Neither approved OKF topics nor raw document chunks matched this question.";
  }

  if (trace?.route === "missing_context") {
    return "The router requested more context before retrieval.";
  }

  if (trace?.route === "unsupported") {
    return "The router marked this question as unsupported by static uploaded documents.";
  }

  return "No supporting evidence was found for this answer.";
}

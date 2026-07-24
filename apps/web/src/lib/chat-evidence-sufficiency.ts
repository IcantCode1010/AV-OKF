import type { ChatRouterDecision } from "./chat-router.ts";
import type { ChatRetrievalResult } from "./chat-retrieval.ts";

export type EvidenceSufficiency =
  | { status: "strong" }
  | { namedGap: string; status: "partial" }
  | { reason: string; status: "weak" }
  | { reason: string; status: "none" };

export type RagInvocationReason =
  | "not_invoked"
  | "hybrid_supporting_context"
  | "graph_evidence_gap"
  | "approved_knowledge_miss"
  | "raw_discovery_route";

export function classifyEvidenceSufficiency(
  retrieval: Pick<
    ChatRetrievalResult,
    | "approvedOkfAvailable"
    | "citations"
    | "metadataClarification"
    | "okfEvidenceMode"
    | "retrievalError"
  >,
  decision: ChatRouterDecision,
): EvidenceSufficiency {
  if (retrieval.retrievalError) {
    return { reason: "retrieval_unavailable", status: "none" };
  }
  if (retrieval.metadataClarification) {
    return { reason: "metadata_clarification_required", status: "weak" };
  }
  if (retrieval.approvedOkfAvailable) {
    if (decision.route === "hybrid") {
      return {
        namedGap: "supporting detail requested by the hybrid route",
        status: "partial",
      };
    }
    if (
      decision.requiresGraphTraversal &&
      retrieval.okfEvidenceMode !== "graph"
    ) {
      return {
        namedGap: "related concept evidence required by the question",
        status: "partial",
      };
    }
    return { status: "strong" };
  }
  if (retrieval.citations.length > 0) {
    return {
      reason: "approved_knowledge_did_not_cover_the_question",
      status: "weak",
    };
  }
  return { reason: "no_supported_evidence_found", status: "none" };
}

export function resolveRagInvocationReason(
  retrieval: Pick<ChatRetrievalResult, "approvedOkfAvailable" | "citations">,
  decision: ChatRouterDecision,
): RagInvocationReason {
  const hasRag = retrieval.citations.some(
    (citation) => citation.sourceType === "rag",
  );
  if (!hasRag) return "not_invoked";
  if (decision.route === "rag_only") return "raw_discovery_route";
  if (retrieval.approvedOkfAvailable && decision.route === "hybrid") {
    return "hybrid_supporting_context";
  }
  if (retrieval.approvedOkfAvailable && decision.requiresGraphTraversal) {
    return "graph_evidence_gap";
  }
  return "approved_knowledge_miss";
}

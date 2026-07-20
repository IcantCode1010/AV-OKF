import { parseCitationMarkers } from "./chat-citation-markers.ts";
import { buildAnswerEvidenceProfile } from "./chat-evidence-profile.ts";
import type { ChatCitation } from "./chat-types.ts";
import type {
  ChatAnswerEvidenceProfile,
  ChatRoute,
  Stage6aRouterTrace,
} from "./chat-router.ts";

export type ChatValidationResult = {
  profile: ChatAnswerEvidenceProfile;
  safeAnswerMode:
    | "release_as_written"
    | "fallback_to_cited_evidence"
    | "answer_with_missing_evidence";
  status: "pass" | "fail";
  violations: string[];
};

/**
 * Validates the evidence contract around an answer. This is intentionally
 * deterministic: claim-level semantic judging belongs to a later stage.
 */
export function validateChatAnswerEvidence(input: {
  answerOutcome?: "answered" | "insufficient_evidence" | "retrieval_unavailable";
  answerContent: string;
  citations: ChatCitation[];
  retrievalError: boolean;
  route: ChatRoute;
  trace?: Partial<Stage6aRouterTrace> | null;
}): ChatValidationResult {
  const profile = buildAnswerEvidenceProfile({
    citations: input.citations,
    trace: input.trace,
  });

  if (input.answerOutcome === "insufficient_evidence") {
    const hasCitationMarkers = parseCitationMarkers(input.answerContent).some(
      (segment) => segment.type === "citation",
    );
    return {
      profile,
      safeAnswerMode: "answer_with_missing_evidence",
      status: hasCitationMarkers ? "fail" : "pass",
      violations: hasCitationMarkers
        ? ["insufficient_evidence_must_not_cite_related_sources"]
        : [],
    };
  }

  if (input.citations.length === 0) {
    const hasCitationMarkers = parseCitationMarkers(input.answerContent).some(
      (segment) => segment.type === "citation",
    );

    return {
      profile,
      safeAnswerMode: "answer_with_missing_evidence",
      status: hasCitationMarkers ? "fail" : "pass",
      violations: hasCitationMarkers
        ? ["citation_marker_without_source"]
        : [],
    };
  }

  const violations: string[] = [];

  if (input.retrievalError) {
    violations.push("citations_present_after_retrieval_error");
  }

  input.citations.forEach((citation, index) => {
    if (citation.index !== index + 1) {
      violations.push(`citation_index_mismatch:${index}`);
    }

    if (!citation.documentTitle.trim() || !citation.text.trim()) {
      violations.push(`citation_missing_source_details:${index}`);
    }

    if (citation.pageStart < 1 || citation.pageEnd < citation.pageStart) {
      violations.push(`citation_invalid_page_range:${index}`);
    }

    if (citation.sourceType !== "okf" && citation.sourceType !== "rag") {
      violations.push(`citation_unknown_source_type:${index}`);
    }
  });

  const hasValidMarkers = parseCitationMarkers(input.answerContent).some(
    (segment) =>
      segment.type === "citation" &&
      segment.index >= 1 &&
      segment.index <= input.citations.length,
  );
  if (!hasValidMarkers) {
    violations.push("answer_missing_valid_citation_marker");
  }

  if (
    input.route === "okf_only" &&
    input.citations.some((citation) => citation.sourceType === "rag") &&
    !input.trace?.ragUsedForDiscoveryOnly
  ) {
    violations.push("raw_rag_used_without_okf_fallback_label");
  }

  return {
    profile,
    safeAnswerMode: violations.length
      ? "fallback_to_cited_evidence"
      : "release_as_written",
    status: violations.length ? "fail" : "pass",
    violations,
  };
}

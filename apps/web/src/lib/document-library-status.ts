import type { DocumentStatus, ExtractionStatus } from "./document-vault.ts";

export type DocumentLibraryStatusInput = {
  assignedToBundle: boolean;
  authoringStatus?: string | null;
  automaticApprovalStatus?: string | null;
  extractionStatus: ExtractionStatus;
  persistedStatus: DocumentStatus;
  ragStatus?: string | null;
  unresolvedTopicCount: number;
};

export function deriveDocumentLibraryStatus(
  input: DocumentLibraryStatusInput,
): DocumentStatus {
  if (
    input.persistedStatus === "blocked" ||
    input.extractionStatus === "failed" ||
    input.authoringStatus === "failed" ||
    input.ragStatus === "failed"
  ) {
    return "blocked";
  }

  if (["queued", "running"].includes(input.extractionStatus)) {
    return "processing";
  }

  if (!input.assignedToBundle || !input.authoringStatus) {
    return "pending";
  }

  if (["awaiting_cost_confirmation", "awaiting_provider"].includes(input.authoringStatus)) {
    return "pending";
  }

  if (
    ["queued", "running", "waiting_for_rag"].includes(input.authoringStatus) ||
    ["queued", "running"].includes(input.automaticApprovalStatus ?? "")
  ) {
    return "processing";
  }

  if (["completed_with_failures", "failed"].includes(input.automaticApprovalStatus ?? "")) {
    return "needs_review";
  }

  if (["ready_for_review", "completed"].includes(input.authoringStatus)) {
    if (input.unresolvedTopicCount > 0) return "needs_review";
    return input.ragStatus === "indexed" ? "indexed" : "processing";
  }

  return "pending";
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import { reviewRetrievalTriggerProposal } from "@/lib/retrieval-trigger-review";

export async function reviewRetrievalTriggerProposalAction(formData: FormData) {
  const knowledgeBundleId = requireFormString(formData, "knowledgeBundleId");
  const proposalId = requireFormString(formData, "proposalId");
  const decisionValue = requireFormString(formData, "decision");
  if (decisionValue !== "approve" && decisionValue !== "reject") {
    throw new Error("retrieval_trigger_decision_invalid");
  }
  const context = await requireAuthWorkspaceContext();
  try {
    await reviewRetrievalTriggerProposal({
      context,
      decision: decisionValue,
      knowledgeBundleId,
      proposalId,
      terms: String(formData.get("terms") ?? "").split(","),
    });
  } catch (error) {
    const code = error instanceof Error && SAFE_REVIEW_ERRORS.has(error.message)
      ? error.message
      : "retrieval_trigger_review_failed";
    redirect(`/knowledge/${knowledgeBundleId}/review?view=gaps&error=${encodeURIComponent(code)}`);
  }
  revalidatePath(`/knowledge/${knowledgeBundleId}/review`);
  redirect(`/knowledge/${knowledgeBundleId}/review?view=gaps`);
}

const SAFE_REVIEW_ERRORS = new Set([
  "knowledge_bundle_not_found",
  "retrieval_trigger_proposal_already_reviewed",
  "retrieval_trigger_proposal_not_found",
  "retrieval_trigger_target_changed",
  "retrieval_trigger_target_path_invalid",
  "retrieval_trigger_target_unavailable",
  "retrieval_trigger_terms_required",
]);

function requireFormString(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  if (!value) throw new Error(`missing_${key}`);
  return value;
}

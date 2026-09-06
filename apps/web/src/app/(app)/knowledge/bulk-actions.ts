"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import {
  confirmBulkTopicApprovalRun,
  createBulkTopicApprovalPreflight,
  retryBulkTopicApprovalRun,
} from "@/lib/bulk-topic-approval";
import { createBulkTopicApprovalQueue } from "@/lib/bulk-topic-approval-queue";

export type PrepareBulkTopicApprovalState = {
  error: string | null;
  confirmationHref: string | null;
};

export async function prepareBulkTopicApprovalAction(
  _previousState: PrepareBulkTopicApprovalState,
  formData: FormData,
): Promise<PrepareBulkTopicApprovalState> {
  const context = await requireAuthWorkspaceContext();
  const bundleId = getString(formData, "knowledgeBundleId");
  const topicIds = formData
    .getAll("topicIds")
    .filter((value): value is string => typeof value === "string");
  try {
    const run = await createBulkTopicApprovalPreflight({
      bundleId,
      context,
      topicIds,
    });
    return {
      error: null,
      confirmationHref: `/knowledge/${encodeURIComponent(bundleId)}/review/${encodeURIComponent(run.id)}`,
    };
  } catch (error) {
    return {
      error: errorMessage(error),
      confirmationHref: null,
    };
  }
}

export async function confirmBulkTopicApprovalAction(formData: FormData) {
  const context = await requireAuthWorkspaceContext();
  const bundleId = getString(formData, "knowledgeBundleId");
  const runId = getString(formData, "runId");
  const queue = createBulkTopicApprovalQueue();
  try {
    await confirmBulkTopicApprovalRun({
      context,
      enqueue: queue.enqueue,
      runId,
    });
  } catch (error) {
    redirect(
      `/knowledge/${bundleId}/review/${runId}?error=${encodeURIComponent(errorMessage(error))}`,
    );
  } finally {
    await queue.close();
  }
  revalidatePath(`/knowledge/${bundleId}/review/${runId}`);
  redirect(`/knowledge/${bundleId}/review/${runId}`);
}

export async function retryBulkTopicApprovalAction(formData: FormData) {
  const context = await requireAuthWorkspaceContext();
  const bundleId = getString(formData, "knowledgeBundleId");
  const runId = getString(formData, "runId");
  const queue = createBulkTopicApprovalQueue();
  try {
    await retryBulkTopicApprovalRun({ context, enqueue: queue.enqueue, runId });
  } catch (error) {
    redirect(
      `/knowledge/${bundleId}/review/${runId}?error=${encodeURIComponent(errorMessage(error))}`,
    );
  } finally {
    await queue.close();
  }
  revalidatePath(`/knowledge/${bundleId}/review/${runId}`);
  redirect(`/knowledge/${bundleId}/review/${runId}`);
}

function getString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function enrichSelectedTopicsAction(
  _previous: { error: string | null; message: string | null },
  formData: FormData,
): Promise<{error:string|null;message:string|null}> {
  const context = await requireAuthWorkspaceContext();
  try {
    const { queueSelectedTopicEnrichment } = await import(
      "@/lib/bulk-topic-enrichment"
    );
    const count = await queueSelectedTopicEnrichment(
      context,
      getString(formData, "knowledgeBundleId"),
      formData
        .getAll("topicIds")
        .filter((id): id is string => typeof id === "string"),
    );
    revalidatePath(
      `/knowledge/${getString(formData, "knowledgeBundleId")}/review`,
    );
    return {
      error: null,
      message: `${count} topics submitted for enrichment. The worker processes them one at a time. Nothing is approved or exported.`,
    };
  } catch {
    return {
      error:
        "Could not queue all selected topics. Refresh to check progress and retry remaining topics.",
      message: null,
    };
  }
}

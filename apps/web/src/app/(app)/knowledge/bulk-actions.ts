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

export async function prepareBulkTopicApprovalAction(formData: FormData) {
  const context = await requireAuthWorkspaceContext();
  const bundleId = getString(formData, "knowledgeBundleId");
  const topicIds = formData.getAll("topicIds").filter((value): value is string => typeof value === "string");
  let runId: string;
  try {
    const run = await createBulkTopicApprovalPreflight({ bundleId, context, topicIds });
    runId = run.id;
  } catch (error) {
    redirect(`/knowledge/${bundleId}/review?error=${encodeURIComponent(errorMessage(error))}`);
  }
  redirect(`/knowledge/${bundleId}/review/${runId}`);
}

export async function confirmBulkTopicApprovalAction(formData: FormData) {
  const context = await requireAuthWorkspaceContext();
  const bundleId = getString(formData, "knowledgeBundleId");
  const runId = getString(formData, "runId");
  const queue = createBulkTopicApprovalQueue();
  try {
    await confirmBulkTopicApprovalRun({ context, enqueue: queue.enqueue, runId });
  } catch (error) {
    redirect(`/knowledge/${bundleId}/review/${runId}?error=${encodeURIComponent(errorMessage(error))}`);
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
    redirect(`/knowledge/${bundleId}/review/${runId}?error=${encodeURIComponent(errorMessage(error))}`);
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

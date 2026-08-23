"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import { getPrisma } from "@/lib/prisma";
import { getTopicExpansionQueue } from "@/lib/topic-expansion-queue";
import {
  cancelTopicExpansionEnrichment,
  cancelTopicExpansionRun,
  confirmTopicExpansionEnrichment,
  confirmTopicExpansionRun,
  prepareTopicExpansionEnrichment,
  prepareTopicExpansionRun,
  rejectTopicExpansionProposal,
} from "@/lib/topic-expansion";

export async function cancelTopicExpansionRunAction(formData: FormData) {
  const knowledgeBundleId = requiredString(formData, "knowledgeBundleId");
  await cancelTopicExpansionRun({ context: await requireAuthWorkspaceContext(), knowledgeBundleId, runId: requiredString(formData, "runId") });
  revalidatePath(`/knowledge/${knowledgeBundleId}/topic-expansion`);
}

export async function cancelTopicExpansionEnrichmentAction(formData: FormData) {
  const knowledgeBundleId = requiredString(formData, "knowledgeBundleId");
  await cancelTopicExpansionEnrichment({ batchId: requiredString(formData, "batchId"), context: await requireAuthWorkspaceContext(), knowledgeBundleId });
  revalidatePath(`/knowledge/${knowledgeBundleId}/topic-expansion`);
}

export async function prepareTopicExpansionRunAction(formData: FormData) {
  const knowledgeBundleId = requiredString(formData, "knowledgeBundleId");
  const context = await requireAuthWorkspaceContext();
  const run = await prepareTopicExpansionRun({ context, knowledgeBundleId });
  revalidatePath(`/knowledge/${knowledgeBundleId}/topic-expansion`);
  redirect(`/knowledge/${knowledgeBundleId}/topic-expansion?run=${run.id}`);
}

export async function confirmTopicExpansionRunAction(formData: FormData) {
  const knowledgeBundleId = requiredString(formData, "knowledgeBundleId");
  const queue = getTopicExpansionQueue();
  await confirmTopicExpansionRun({ context: await requireAuthWorkspaceContext(), enqueue: queue.enqueue, knowledgeBundleId, runId: requiredString(formData, "runId") });
  revalidatePath(`/knowledge/${knowledgeBundleId}/topic-expansion`);
  redirect(`/knowledge/${knowledgeBundleId}/topic-expansion`);
}

export async function retryTopicExpansionRunAction(formData: FormData) {
  const knowledgeBundleId = requiredString(formData, "knowledgeBundleId");
  const runId = requiredString(formData, "runId");
  const context = await requireAuthWorkspaceContext();
  const run = await getPrisma().topicExpansionRun.findFirst({ where: { id: runId, knowledgeBundleId, workspaceId: context.workspaceId } });
  if (!run) throw new Error("topic_expansion_run_not_found");
  if (!["awaiting_provider", "failed"].includes(run.status)) throw new Error("topic_expansion_run_not_retryable");
  await getPrisma().topicExpansionRun.update({ data: { errorCode: null, errorMessage: null, status: "queued" }, where: { id: run.id } });
  await getTopicExpansionQueue().enqueue({ kind: "crawl", runId: run.id, workspaceId: run.workspaceId });
  revalidatePath(`/knowledge/${knowledgeBundleId}/topic-expansion`);
  redirect(`/knowledge/${knowledgeBundleId}/topic-expansion`);
}

export async function prepareTopicExpansionEnrichmentAction(formData: FormData) {
  const knowledgeBundleId = requiredString(formData, "knowledgeBundleId");
  const proposalIds = formData.getAll("proposalIds").filter((value): value is string => typeof value === "string" && Boolean(value.trim()));
  const batch = await prepareTopicExpansionEnrichment({ context: await requireAuthWorkspaceContext(), knowledgeBundleId, proposalIds });
  revalidatePath(`/knowledge/${knowledgeBundleId}/topic-expansion`);
  redirect(`/knowledge/${knowledgeBundleId}/topic-expansion?batch=${batch.id}`);
}

export async function confirmTopicExpansionEnrichmentAction(formData: FormData) {
  const knowledgeBundleId = requiredString(formData, "knowledgeBundleId");
  await confirmTopicExpansionEnrichment({ batchId: requiredString(formData, "batchId"), context: await requireAuthWorkspaceContext(), enqueue: getTopicExpansionQueue().enqueue, knowledgeBundleId });
  revalidatePath(`/knowledge/${knowledgeBundleId}/topic-expansion`);
  revalidatePath(`/knowledge/${knowledgeBundleId}/review`);
  redirect(`/knowledge/${knowledgeBundleId}/topic-expansion`);
}

export async function rejectTopicExpansionProposalAction(formData: FormData) {
  const knowledgeBundleId = requiredString(formData, "knowledgeBundleId");
  await rejectTopicExpansionProposal({ context: await requireAuthWorkspaceContext(), knowledgeBundleId, proposalId: requiredString(formData, "proposalId"), restore: requiredString(formData, "decision") === "restore" });
  revalidatePath(`/knowledge/${knowledgeBundleId}/topic-expansion`);
}

export async function retryTopicExpansionEnrichmentAction(formData: FormData) {
  const knowledgeBundleId = requiredString(formData, "knowledgeBundleId");
  const jobId = requiredString(formData, "jobId");
  const context = await requireAuthWorkspaceContext();
  const job = await getPrisma().topicEnrichmentJob.findFirst({ where: { id: jobId, knowledgeBundleId, workspaceId: context.workspaceId } });
  if (!job || !["failed", "cancelled"].includes(job.status)) throw new Error("topic_expansion_enrichment_not_retryable");
  await getPrisma().$transaction([
    getPrisma().topicEnrichmentJob.update({ data: { errorCode: null, errorMessage: null, status: "queued" }, where: { id: job.id } }),
    getPrisma().topicExpansionProposal.updateMany({ data: { status: "enriching" }, where: { id: job.proposalId ?? "", workspaceId: context.workspaceId } }),
    getPrisma().topicExpansionEnrichmentItem.updateMany({ data: { errorCode: null, errorMessage: null, status: "queued" }, where: { proposalId: job.proposalId ?? "", topicId: job.topicId } }),
  ]);
  await getTopicExpansionQueue().enqueue({ jobId: job.id, kind: "enrich", workspaceId: job.workspaceId });
  revalidatePath(`/knowledge/${knowledgeBundleId}/topic-expansion`);
}

function requiredString(formData: FormData, key: string) {
  const value = formData.get(key);
  if (typeof value !== "string" || !value.trim()) throw new Error(`missing_${key}`);
  return value.trim();
}

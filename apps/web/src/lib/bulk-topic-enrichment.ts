import { randomUUID } from "node:crypto";
import { recordEnrichmentProgress } from "./enrichment-progress.ts";
import { createPostgresDocumentRepository } from "./production-repository.ts";
import { Queue } from "bullmq";
import { getPrisma } from "./prisma.ts";
import { enrichTopic } from "./topic-enrichment.ts";
import type { AuthWorkspaceContext } from "./auth-workspace.ts";
export const BULK_ENRICHMENT_QUEUE = "selected-topic-enrichment";
export type SelectedEnrichmentJob = {
  batchId?: string;
  queuedAt?: number;
  topicId: string;
  workspaceId: string;
  userId: string;
  bundleId: string;
};
export function canEnrichSelectedTopic(topic: {
  reviewStatus: string;
  enrichmentStatus: string;
}) {
  return (
    !["approved", "rejected"].includes(topic.reviewStatus) &&
    ["none", "failed"].includes(topic.enrichmentStatus)
  );
}
export async function queueSelectedTopicEnrichment(
  context: AuthWorkspaceContext,
  bundleId: string,
  rawIds: string[],
) {
  const db = getPrisma(),
    ids = [...new Set(rawIds)];
  if (!ids.length || ids.length > 1000)
    throw Error("select_between_1_and_1000_topics");
  await db.workspaceMember.findUniqueOrThrow({
    where: {
      workspaceId_userId: {
        workspaceId: context.workspaceId,
        userId: context.userId,
      },
    },
  });
  const topics = await db.topicRecord.findMany({
    where: {
      id: { in: ids },
      workspaceId: context.workspaceId,
      knowledgeBundleId: bundleId,
      document: { deletedAt: null },
    },
  });
  if (topics.length !== ids.length)
    throw Error("topic_selection_scope_mismatch");
  if (topics.some((t) => !canEnrichSelectedTopic(t)))
    throw Error("selection_contains_topics_not_ready_for_enrichment");
  if (!process.env.REDIS_URL) throw Error("worker_queue_unavailable");
  const queue = new Queue<SelectedEnrichmentJob>(BULK_ENRICHMENT_QUEUE, {
    connection: { url: process.env.REDIS_URL },
  });
  const batchId = randomUUID();
  let queued = 0;
  try {
    for (const topic of topics) {
      const jobId = `enrich-${topic.id}`;
      const old = await queue.getJob(jobId);
      if (old) {
        const state = await old.getState();
        if (state === "failed" || state === "completed") await old.remove();
        else continue;
      }
      await queue.add(
        "enrich",
        {
          batchId,
          queuedAt: Date.now(),
          topicId: topic.id,
          workspaceId: context.workspaceId,
          userId: context.userId,
          bundleId,
        },
        {
          jobId,
          attempts: 2,
          backoff: { type: "exponential", delay: 5000 },
          removeOnComplete: { age: 604800, count: 10000 },
          removeOnFail: { age: 604800, count: 10000 },
        },
      );
      queued++;
      await recordEnrichmentProgress({ topicId: topic.id, workspaceId: context.workspaceId,
        bundleId, batchId, status: "queued", queuedAt: new Date() });
    }
    return queued;
  } finally {
    await queue.close();
  }
}
export async function runSelectedTopicEnrichment(job: SelectedEnrichmentJob, recovering = false) {
  const db = getPrisma();
  const member = await db.workspaceMember.findUniqueOrThrow({
    where: {
      workspaceId_userId: { workspaceId: job.workspaceId, userId: job.userId },
    },
  });
  let topic = await db.topicRecord.findFirstOrThrow({
    where: {
      id: job.topicId,
      workspaceId: job.workspaceId,
      knowledgeBundleId: job.bundleId,
      document: { deletedAt: null },
    },
  });
  if (recovering && topic.enrichmentStatus === "pending" && !["approved", "rejected"].includes(topic.reviewStatus)) {
    await db.topicRecord.updateMany({ where: { id: topic.id, workspaceId: job.workspaceId, enrichmentStatus: "pending", reviewStatus: { notIn: ["approved", "rejected"] } }, data: { enrichmentStatus: "failed" } });
    topic = await db.topicRecord.findUniqueOrThrow({ where: { id: topic.id } });
  }
  if (!canEnrichSelectedTopic(topic)) return;
  const progress = {
    topicId: topic.id,
    workspaceId: job.workspaceId,
    bundleId: job.bundleId,
    batchId: job.batchId ?? `legacy:${topic.documentId}`,
    queuedAt: new Date(job.queuedAt ?? Date.now()),
  };
  const startedAt = new Date();
  await recordEnrichmentProgress({ ...progress, status: "running", startedAt });
  try {
    const result = await enrichTopic(topic.id, {
      repository: createPostgresDocumentRepository(),
      context: {
        workspaceId: job.workspaceId,
        userId: job.userId,
        role: member.role === "admin" ? "admin" : "member",
      },
    });
    assertEnrichmentSucceeded(result);
    await recordEnrichmentProgress({
      ...progress,
      status: "completed",
      startedAt,
      completedAt: new Date(),
    });
  } catch (error) {
    await recordEnrichmentProgress({
      ...progress,
      status: "failed",
      startedAt,
      completedAt: new Date(),
    });
    throw error;
  }
}

export function assertEnrichmentSucceeded(result: { enrichmentStatus: string }) {
  if (result.enrichmentStatus === "failed") throw new Error("topic_enrichment_failed_see_topic_details");
  if (!["completed", "review_required"].includes(result.enrichmentStatus)) throw new Error("topic_enrichment_incomplete");
}

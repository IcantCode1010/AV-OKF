import { Queue } from "bullmq";

import { TOPIC_CONTINUATION_RESOLVER_VERSION } from "./topic-discovery.ts";

export type TopicContinuationReconciliationPayload = {
  documentId: string;
  workspaceId: string;
};

export function buildTopicContinuationReconciliationJobId(
  payload: TopicContinuationReconciliationPayload,
) {
  for (const value of Object.values(payload)) {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) {
      throw new Error("invalid_topic_continuation_reconciliation_job_id");
    }
  }
  return `topic-continuation-${TOPIC_CONTINUATION_RESOLVER_VERSION}-${payload.documentId}`;
}

export function createTopicContinuationReconciliationQueue(
  redisUrl = process.env.REDIS_URL,
) {
  if (!redisUrl) throw new Error("missing_env_REDIS_URL");
  const queue = new Queue<TopicContinuationReconciliationPayload>(
    "topic-continuation-reconciliation",
    { connection: { url: redisUrl } },
  );
  return {
    async close() {
      await queue.close();
    },
    async enqueue(payload: TopicContinuationReconciliationPayload) {
      const jobId = buildTopicContinuationReconciliationJobId(payload);
      const existing = await queue.getJob(jobId);
      if (existing) {
        const state = await existing.getState();
        if (state === "completed" || state === "failed") await existing.remove();
        else return;
      }
      await queue.add("reconcile", payload, {
        attempts: 3,
        backoff: { delay: 2_000, type: "exponential" },
        jobId,
        removeOnComplete: 100,
        removeOnFail: 100,
      });
    },
  };
}

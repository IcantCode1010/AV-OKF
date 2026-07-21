import { Queue } from "bullmq";

export type BulkTopicApprovalJobPayload = {
  runId: string;
  workspaceId: string;
};

export function buildBulkTopicApprovalJobId(payload: BulkTopicApprovalJobPayload) {
  return `bulk-topic-approval-${payload.runId}`;
}

export function createBulkTopicApprovalQueue(redisUrl = process.env.REDIS_URL) {
  if (!redisUrl) throw new Error("missing_env_REDIS_URL");
  const queue = new Queue<BulkTopicApprovalJobPayload>("bulk-topic-approval", {
    connection: { url: redisUrl },
  });
  return {
    async close() {
      await queue.close();
    },
    async enqueue(payload: BulkTopicApprovalJobPayload) {
      const jobId = buildBulkTopicApprovalJobId(payload);
      const existing = await queue.getJob(jobId);
      if (existing) {
        const state = await existing.getState();
        if (state === "completed" || state === "failed") await existing.remove();
        else return;
      }
      await queue.add("approve-and-export", payload, {
        attempts: 2,
        backoff: { delay: 2_000, type: "exponential" },
        jobId,
        removeOnComplete: 100,
        removeOnFail: 100,
      });
    },
  };
}

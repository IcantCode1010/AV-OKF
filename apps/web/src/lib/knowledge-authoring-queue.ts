import { Queue } from "bullmq";

export type KnowledgeAuthoringJobPayload = {
  documentId: string;
  runId: string;
  workspaceId: string;
};

export function buildKnowledgeAuthoringJobId(payload: KnowledgeAuthoringJobPayload) {
  return `knowledge-authoring-${payload.runId}`;
}

export function createBullMqKnowledgeAuthoringQueue(redisUrl: string) {
  const queue = new Queue<KnowledgeAuthoringJobPayload>("knowledge-authoring", {
    connection: { url: redisUrl },
  });

  return {
    async close() {
      await queue.close();
    },
    async enqueue(payload: KnowledgeAuthoringJobPayload) {
      const jobId = buildKnowledgeAuthoringJobId(payload);
      const existingJob = await queue.getJob(jobId);
      if (existingJob) {
        const state = await existingJob.getState();
        if (state === "completed" || state === "failed") {
          await existingJob.remove();
        } else {
          return;
        }
      }
      await queue.add("author-document", payload, {
        attempts: 2,
        backoff: { delay: 2_000, type: "exponential" },
        jobId,
        removeOnComplete: 100,
        removeOnFail: 100,
      });
    },
  };
}

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
    async enqueue(
      payload: KnowledgeAuthoringJobPayload,
      options: { waitForActive?: boolean } = {},
    ) {
      const jobId = buildKnowledgeAuthoringJobId(payload);
      let existingJob = await queue.getJob(jobId);
      if (existingJob && options.waitForActive) {
        for (let attempt = 0; attempt < 50; attempt += 1) {
          if (await existingJob.getState() !== "active") break;
          await new Promise((resolve) => setTimeout(resolve, 100));
          existingJob = await queue.getJob(jobId);
          if (!existingJob) break;
        }
      }
      if (existingJob) {
        const state = await existingJob.getState();
        if (state === "completed" || state === "failed") {
          await existingJob.remove();
        } else if (state === "active" && options.waitForActive) {
          throw new Error("knowledge_authoring_parent_job_still_active");
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

import { createHash } from "node:crypto";

import { Queue } from "bullmq";

export type OkfConceptEmbeddingJobPayload = {
  contentHash: string;
  filePath: string;
  jobId: string;
  knowledgeBundleId: string;
  workspaceId: string;
};

export type OkfConceptEmbeddingQueue = {
  enqueue(payload: OkfConceptEmbeddingJobPayload): Promise<void>;
};

let cachedQueue: OkfConceptEmbeddingQueue | null = null;

export function buildOkfConceptEmbeddingQueueJobId(payload: Pick<
  OkfConceptEmbeddingJobPayload,
  "contentHash" | "filePath" | "knowledgeBundleId"
>) {
  const identity = createHash("sha256")
    .update(`${payload.knowledgeBundleId}:${payload.filePath}:${payload.contentHash}`)
    .digest("hex")
    .slice(0, 32);
  return `okf-concept-embedding-${identity}`;
}

export function createBullMqOkfConceptEmbeddingQueue(
  redisUrl = requiredEnv("REDIS_URL"),
): OkfConceptEmbeddingQueue {
  const queue = new Queue<OkfConceptEmbeddingJobPayload>("okf-concept-embedding", {
    connection: { url: redisUrl },
  });
  return {
    async enqueue(payload) {
      const bullJobId = buildOkfConceptEmbeddingQueueJobId(payload);
      const existing = await queue.getJob(bullJobId);
      if (existing) {
        const state = await existing.getState();
        if (state === "completed" || state === "failed") await existing.remove();
        else return;
      }
      await queue.add("embed-concept", payload, {
        attempts: 3,
        backoff: { delay: 5_000, type: "exponential" },
        jobId: bullJobId,
        removeOnComplete: 500,
        removeOnFail: 1_000,
      });
    },
  };
}

export function getOkfConceptEmbeddingQueue() {
  if (!cachedQueue) cachedQueue = createBullMqOkfConceptEmbeddingQueue();
  return cachedQueue;
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`missing_env_${name}`);
  return value;
}

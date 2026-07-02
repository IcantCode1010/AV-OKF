import { Queue } from "bullmq";

export type RagIndexJobPayload = {
  chunkingStrategyId?: string;
  documentId: string;
  indexJobId: string;
  indexVersion: number;
  mode?: "initial" | "reindex";
  workspaceId: string;
};

export type RagIndexQueue = {
  enqueueIndexJob(payload: RagIndexJobPayload): Promise<void>;
};

let cachedQueue: RagIndexQueue | null = null;

export function buildRagIndexJobId(input: {
  documentId: string;
  indexJobId: string;
}) {
  assertSafeQueueSegment(input.documentId);
  assertSafeQueueSegment(input.indexJobId);
  return `rag-index:${input.documentId}:${input.indexJobId}`;
}

export function createBullMqRagIndexQueue(
  redisUrl = requiredEnv("REDIS_URL"),
): RagIndexQueue {
  const queue = new Queue<RagIndexJobPayload>("rag-index", {
    connection: { url: redisUrl },
  });

  return {
    async enqueueIndexJob(payload) {
      await queue.add("index", payload, {
        attempts: 3,
        backoff: { delay: 5_000, type: "exponential" },
        jobId: buildRagIndexJobId(payload),
        removeOnComplete: 500,
        removeOnFail: 1_000,
      });
    },
  };
}

export function getRagIndexQueue() {
  if (!cachedQueue) {
    cachedQueue = createBullMqRagIndexQueue();
  }

  return cachedQueue;
}

function assertSafeQueueSegment(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("unsafe_queue_id_segment");
  }
}

function requiredEnv(key: string) {
  const value = process.env[key];

  if (!value) {
    throw new Error(`missing_env_${key}`);
  }

  return value;
}

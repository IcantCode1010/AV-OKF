import { Queue } from "bullmq";

export type ExtractionJobPayload = {
  documentId: string;
  extractionJobId: string;
  workspaceId: string;
};

export type ExtractionQueue = {
  enqueueExtractionJob(payload: ExtractionJobPayload): Promise<void>;
};

let cachedQueue: ExtractionQueue | null = null;

export function buildExtractionJobId(input: {
  documentId: string;
  extractionJobId: string;
}) {
  assertSafeQueueSegment(input.documentId);
  assertSafeQueueSegment(input.extractionJobId);
  return `extract:${input.documentId}:${input.extractionJobId}`;
}

export function createBullMqExtractionQueue(redisUrl = requiredEnv("REDIS_URL")): ExtractionQueue {
  const queue = new Queue<ExtractionJobPayload>("extraction", {
    connection: {
      url: redisUrl,
    },
  });

  return {
    async enqueueExtractionJob(payload) {
      await queue.add("extract", payload, {
        attempts: 3,
        backoff: {
          delay: 5_000,
          type: "exponential",
        },
        jobId: buildExtractionJobId(payload),
        removeOnComplete: 500,
        removeOnFail: 1_000,
      });
    },
  };
}

export function getExtractionQueue() {
  if (!cachedQueue) {
    cachedQueue = createBullMqExtractionQueue();
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

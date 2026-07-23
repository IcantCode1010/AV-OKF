import { Queue } from "bullmq";

export type OkfRelationVerificationJobPayload = {
  candidateId: string;
  knowledgeBundleId: string;
  workspaceId: string;
};

export type OkfRelationVerificationQueue = {
  enqueue(payload: OkfRelationVerificationJobPayload): Promise<void>;
};

let cachedQueue: OkfRelationVerificationQueue | null = null;

export function buildOkfRelationVerificationJobId(candidateId: string) {
  return `okf-relation-verification-${candidateId}`;
}

export function createOkfRelationVerificationQueue(
  redisUrl = requiredEnv("REDIS_URL"),
): OkfRelationVerificationQueue & { close(): Promise<void> } {
  const queue = new Queue<OkfRelationVerificationJobPayload>("okf-relation-verification", {
    connection: { url: redisUrl },
  });
  return {
    async close() {
      await queue.close();
    },
    async enqueue(payload) {
      const jobId = buildOkfRelationVerificationJobId(payload.candidateId);
      const existing = await queue.getJob(jobId);
      if (existing) {
        const state = await existing.getState();
        if (state === "completed" || state === "failed") await existing.remove();
        else return;
      }
      await queue.add("verify-relation", payload, {
        attempts: 3,
        backoff: { delay: 5_000, type: "exponential" },
        jobId,
        removeOnComplete: 500,
        removeOnFail: 1_000,
      });
    },
  };
}

export function getOkfRelationVerificationQueue() {
  if (!cachedQueue) cachedQueue = createOkfRelationVerificationQueue();
  return cachedQueue;
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`missing_env_${name}`);
  return value;
}

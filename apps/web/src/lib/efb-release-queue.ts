import { Queue } from "bullmq";

export const EFB_RELEASE_QUEUE_NAME = "efb-release";

export type EfbReleaseJobPayload = {
  jobId: string;
  workspaceId: string;
};

export type EfbReleaseQueue = {
  close(): Promise<void>;
  enqueue(payload: EfbReleaseJobPayload): Promise<void>;
};

export function createEfbReleaseQueue(
  redisUrl = process.env.REDIS_URL ?? requiredEnv("REDIS_URL"),
): EfbReleaseQueue {
  const queue = new Queue<EfbReleaseJobPayload>(EFB_RELEASE_QUEUE_NAME, {
    connection: { url: redisUrl },
  });
  return {
    async close() {
      await queue.close();
    },
    async enqueue(payload) {
      if (!/^[a-zA-Z0-9_-]+$/.test(payload.jobId)) {
        throw new Error("efb_release_job_identity_invalid");
      }
      const jobId = `efb-release-${payload.jobId}`;
      const existing = await queue.getJob(jobId);
      if (existing) {
        const state = await existing.getState();
        if (state === "completed" || state === "failed") await existing.remove();
        else return;
      }
      await queue.add("export", payload, {
        attempts: 3,
        backoff: { delay: 2_000, type: "exponential" },
        jobId,
        removeOnComplete: true,
        removeOnFail: false,
      });
    },
  };
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`missing_env_${name}`);
  return value;
}

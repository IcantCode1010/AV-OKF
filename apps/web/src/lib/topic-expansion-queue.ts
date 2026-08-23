import { Queue } from "bullmq";

export const TOPIC_EXPANSION_QUEUE_NAME = "topic-expansion";

export type TopicExpansionJobPayload =
  | { kind: "crawl"; runId: string; workspaceId: string }
  | { jobId: string; kind: "enrich"; workspaceId: string };

export type TopicExpansionQueue = {
  close(): Promise<void>;
  enqueue(payload: TopicExpansionJobPayload): Promise<void>;
};

export function createTopicExpansionQueue(redisUrl = process.env.REDIS_URL ?? requiredEnv("REDIS_URL")): TopicExpansionQueue {
  const queue = new Queue<TopicExpansionJobPayload>(TOPIC_EXPANSION_QUEUE_NAME, { connection: { url: redisUrl } });
  return {
    async close() { await queue.close(); },
    async enqueue(payload) {
      const jobId = buildTopicExpansionJobId(payload);
      await ensureTopicExpansionJobQueued({
        add: async () => {
          await queue.add(payload.kind, payload, {
            attempts: 3,
            backoff: { delay: 2_000, type: "exponential" },
            jobId,
            removeOnComplete: true,
            removeOnFail: false,
          });
        },
        getExisting: async () => {
          const existing = await queue.getJob(jobId);
          return existing ? { getState: () => existing.getState(), remove: () => existing.remove() } : null;
        },
      });
    },
  };
}

export async function ensureTopicExpansionJobQueued(input: {
  add: () => Promise<void>;
  getExisting: () => Promise<{ getState: () => Promise<string>; remove: () => Promise<void> } | null>;
}) {
  const existing = await input.getExisting();
  if (!existing) {
    await input.add();
    return "added" as const;
  }
  const state = await existing.getState();
  if (state === "completed" || state === "failed") {
    await existing.remove();
    await input.add();
    return "replaced" as const;
  }
  return "existing" as const;
}

export function buildTopicExpansionJobId(payload: TopicExpansionJobPayload) {
  const identity = payload.kind === "crawl" ? payload.runId : payload.jobId;
  if (!/^[a-zA-Z0-9_-]+$/.test(identity)) throw new Error("topic_expansion_job_identity_invalid");
  return `topic-expansion-${payload.kind}-${identity}`;
}

let cachedQueue: TopicExpansionQueue | null = null;

export function getTopicExpansionQueue() {
  if (!cachedQueue) cachedQueue = createTopicExpansionQueue();
  return cachedQueue;
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`missing_env_${name}`);
  return value;
}

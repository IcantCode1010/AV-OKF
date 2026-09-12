import { Queue } from "bullmq";

export const ENTITY_GRAPH_QUEUE_NAME = "entity-graph";

export type EntityGraphJobPayload =
  | { jobId: string; kind: "extract"; workspaceId: string }
  | { kind: "expand"; runId: string; workspaceId: string };

export type EntityGraphQueue = {
  enqueue(payload: EntityGraphJobPayload): Promise<void>;
};

export function createEntityGraphQueue(
  redisUrl = process.env.REDIS_URL ?? requiredEnv("REDIS_URL"),
): EntityGraphQueue {
  const queue = new Queue<EntityGraphJobPayload>(ENTITY_GRAPH_QUEUE_NAME, {
    connection: { url: redisUrl },
  });
  return {
    async enqueue(payload) {
      const identity = payload.kind === "extract" ? payload.jobId : payload.runId;
      await queue.add(payload.kind, payload, {
        attempts: 3,
        backoff: { delay: 2_000, type: "exponential" },
        jobId: `entity-${payload.kind}-${identity}`,
        removeOnComplete: true,
        removeOnFail: false,
      });
    },
  };
}

let cachedQueue: EntityGraphQueue | null = null;

export function getEntityGraphQueue() {
  if (!cachedQueue) cachedQueue = createEntityGraphQueue();
  return cachedQueue;
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`missing_env_${name}`);
  return value;
}

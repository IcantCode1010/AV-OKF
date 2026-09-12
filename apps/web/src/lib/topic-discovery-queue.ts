import { Queue } from "bullmq";

export type TopicDiscoveryJobPayload = {
  documentId: string;
  topicDiscoveryJobId: string;
  workspaceId: string;
};

export function buildTopicDiscoveryJobId(payload: TopicDiscoveryJobPayload) {
  for (const value of Object.values(payload)) {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid_topic_discovery_job_id");
  }
  return `topics-${payload.documentId}-${payload.topicDiscoveryJobId}`;
}

export function createBullMqTopicDiscoveryQueue(redisUrl: string) {
  const queue = new Queue<TopicDiscoveryJobPayload>("topic-discovery", {
    connection: { url: redisUrl },
  });
  return {
    async enqueue(payload: TopicDiscoveryJobPayload) {
      const jobId = buildTopicDiscoveryJobId(payload);
      const existingJob = await queue.getJob(jobId);
      if (existingJob) {
        const state = await existingJob.getState();
        if (state === "completed" || state === "failed") {
          await existingJob.remove();
        } else {
          return;
        }
      }
      await queue.add("discover", payload, {
        attempts: 2,
        backoff: { delay: 5_000, type: "exponential" },
        jobId,
        removeOnComplete: 100,
        removeOnFail: 500,
      });
    },
  };
}

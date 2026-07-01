import { Worker } from "bullmq";

import { createPostgresDocumentRepository } from "../lib/production-repository.ts";
import { createBullMqExtractionQueue, type ExtractionJobPayload } from "../lib/production-queue.ts";
import { getObjectStorage } from "../lib/production-storage.ts";
import { runProductionExtractionJob } from "../lib/production-worker.ts";

let worker: Worker<ExtractionJobPayload> | null = null;

void main();

async function main() {
  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    throw new Error("missing_env_REDIS_URL");
  }

  const repository = createPostgresDocumentRepository();
  const storage = getObjectStorage();
  const queue = createBullMqExtractionQueue(redisUrl);

  await reconcileQueuedJobs(repository, queue);

  worker = new Worker<ExtractionJobPayload>(
    "extraction",
    async (job) => {
      await runProductionExtractionJob(job.data, {
        repository,
        storage,
      });
    },
    {
      concurrency: Number(process.env.EXTRACTION_WORKER_CONCURRENCY ?? "2"),
      connection: {
        url: redisUrl,
      },
    },
  );

  worker.on("completed", (job) => {
    console.log(`Extraction job completed: ${job.id}`);
  });

  worker.on("failed", (job, error) => {
    console.error(`Extraction job failed: ${job?.id ?? "unknown"}`, error);
  });

  process.on("SIGINT", () => {
    void shutdown();
  });

  process.on("SIGTERM", () => {
    void shutdown();
  });
}

async function reconcileQueuedJobs(
  repository: ReturnType<typeof createPostgresDocumentRepository>,
  queue: ReturnType<typeof createBullMqExtractionQueue>,
) {
  const jobs = await repository.getQueuedExtractionJobs();

  for (const job of jobs) {
    await queue.enqueueExtractionJob({
      documentId: job.documentId,
      extractionJobId: job.id,
      workspaceId: job.workspaceId,
    });
  }

  if (jobs.length > 0) {
    console.log(`Re-enqueued ${jobs.length} extraction jobs.`);
  }
}

async function shutdown() {
  await worker?.close();
  process.exit(0);
}

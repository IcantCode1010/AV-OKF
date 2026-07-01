import { Worker } from "bullmq";

import { createPostgresDocumentRepository } from "../lib/production-repository.ts";
import { createBullMqExtractionQueue, type ExtractionJobPayload } from "../lib/production-queue.ts";
import { runRagIndexJob } from "../lib/rag-indexer.ts";
import { createBullMqRagIndexQueue, type RagIndexJobPayload } from "../lib/rag-queue.ts";
import { createRagRepository } from "../lib/rag-repository.ts";
import { getObjectStorage } from "../lib/production-storage.ts";
import { runProductionExtractionJob } from "../lib/production-worker.ts";

let extractionWorker: Worker<ExtractionJobPayload> | null = null;
let ragWorker: Worker<RagIndexJobPayload> | null = null;

void main();

async function main() {
  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    throw new Error("missing_env_REDIS_URL");
  }

  const repository = createPostgresDocumentRepository();
  const ragRepository = createRagRepository();
  const storage = getObjectStorage();
  const queue = createBullMqExtractionQueue(redisUrl);
  const ragQueue = createBullMqRagIndexQueue(redisUrl);

  await reconcileQueuedJobs(repository, queue);
  await reconcileQueuedRagJobs(ragRepository, ragQueue);

  extractionWorker = new Worker<ExtractionJobPayload>(
    "extraction",
    async (job) => {
      await runProductionExtractionJob(job.data, {
        ragQueue,
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

  ragWorker = new Worker<RagIndexJobPayload>(
    "rag-index",
    async (job) => {
      await runRagIndexJob(job.data);
    },
    {
      concurrency: Number(process.env.RAG_INDEX_WORKER_CONCURRENCY ?? "1"),
      connection: {
        url: redisUrl,
      },
    },
  );

  extractionWorker.on("completed", (job) => {
    console.log(`Extraction job completed: ${job.id}`);
  });

  extractionWorker.on("failed", (job, error) => {
    console.error(`Extraction job failed: ${job?.id ?? "unknown"}`, error);
  });

  ragWorker.on("completed", (job) => {
    console.log(`RAG index job completed: ${job.id}`);
  });

  ragWorker.on("failed", (job, error) => {
    console.error(`RAG index job failed: ${job?.id ?? "unknown"}`, error);
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

async function reconcileQueuedRagJobs(
  repository: ReturnType<typeof createRagRepository>,
  queue: ReturnType<typeof createBullMqRagIndexQueue>,
) {
  const jobs = await repository.getQueuedIndexJobs();

  for (const job of jobs) {
    await queue.enqueueIndexJob({
      documentId: job.documentId,
      indexJobId: job.id,
      indexVersion: job.indexVersion,
      workspaceId: job.workspaceId,
    });
  }

  if (jobs.length > 0) {
    console.log(`Re-enqueued ${jobs.length} RAG index jobs.`);
  }
}

async function shutdown() {
  await extractionWorker?.close();
  await ragWorker?.close();
  process.exit(0);
}

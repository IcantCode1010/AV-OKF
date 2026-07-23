import { Worker } from "bullmq";

import { createPostgresDocumentRepository } from "../lib/production-repository.ts";
import { createBullMqExtractionQueue, type ExtractionJobPayload } from "../lib/production-queue.ts";
import { runRagIndexJob } from "../lib/rag-indexer.ts";
import { createBullMqRagIndexQueue, type RagIndexJobPayload } from "../lib/rag-queue.ts";
import { getDefaultChunkingStrategyId } from "../lib/rag-reindex.ts";
import { createRagRepository } from "../lib/rag-repository.ts";
import { getObjectStorage } from "../lib/production-storage.ts";
import { runProductionExtractionJob } from "../lib/production-worker.ts";
import { runTopicDiscoveryJob } from "../lib/topic-discovery-service.ts";
import {
  createBullMqTopicDiscoveryQueue,
  type TopicDiscoveryJobPayload,
} from "../lib/topic-discovery-queue.ts";
import {
  enqueuePendingTopicContinuationReconciliations,
  runTopicContinuationReconciliation,
} from "../lib/topic-continuation-reconciliation.ts";
import {
  createTopicContinuationReconciliationQueue,
  type TopicContinuationReconciliationPayload,
} from "../lib/topic-continuation-reconciliation-queue.ts";
import { runKnowledgeAuthoringJob } from "../lib/knowledge-authoring.ts";
import {
  createBullMqKnowledgeAuthoringQueue,
  type KnowledgeAuthoringJobPayload,
} from "../lib/knowledge-authoring-queue.ts";
import {
  enqueueKnowledgeBundleDeletionJob,
  reconcileKnowledgeBundleDeletionJobs,
  runKnowledgeBundleDeletionJob,
  type KnowledgeBundleDeletionJobPayload,
} from "../lib/knowledge-bundle-deletion.ts";
import {
  createOkfConceptEmbeddingRepository,
  reconcileOkfConceptEmbeddings,
  runOkfConceptEmbeddingJob,
} from "../lib/okf-concept-embedding.ts";
import {
  getOkfConceptEmbeddingQueue,
  type OkfConceptEmbeddingJobPayload,
} from "../lib/okf-concept-embedding-queue.ts";
import {
  createBulkTopicApprovalQueue,
  type BulkTopicApprovalJobPayload,
} from "../lib/bulk-topic-approval-queue.ts";
import {
  createAutomaticBulkApprovalRun,
  reconcileBulkTopicApprovalRuns,
  runBulkTopicApprovalJob,
} from "../lib/bulk-topic-approval.ts";
import {
  enqueueDocumentDeletionJob,
  reconcileDocumentDeletionJobs,
  runPermanentDocumentDeletionJob,
  type DocumentDeletionJobPayload,
} from "../lib/document-deletion.ts";
import {
  reconcileOkfRelationVerificationJobs,
  runOkfRelationVerificationJob,
} from "../lib/okf-relation-verification.ts";
import {
  createOkfRelationVerificationQueue,
  type OkfRelationVerificationJobPayload,
} from "../lib/okf-relation-verification-queue.ts";

let extractionWorker: Worker<ExtractionJobPayload> | null = null;
let ragWorker: Worker<RagIndexJobPayload> | null = null;
let bundleDeletionWorker: Worker<KnowledgeBundleDeletionJobPayload> | null = null;
let topicDiscoveryWorker: Worker<TopicDiscoveryJobPayload> | null = null;
let knowledgeAuthoringWorker: Worker<KnowledgeAuthoringJobPayload> | null = null;
let okfEmbeddingWorker: Worker<OkfConceptEmbeddingJobPayload> | null = null;
let bulkTopicApprovalWorker: Worker<BulkTopicApprovalJobPayload> | null = null;
let documentDeletionWorker: Worker<DocumentDeletionJobPayload> | null = null;
let topicContinuationWorker: Worker<TopicContinuationReconciliationPayload> | null = null;
let relationVerificationWorker: Worker<OkfRelationVerificationJobPayload> | null = null;

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
  const topicDiscoveryQueue = createBullMqTopicDiscoveryQueue(redisUrl);
  const topicContinuationQueue = createTopicContinuationReconciliationQueue(redisUrl);
  const knowledgeAuthoringQueue = createBullMqKnowledgeAuthoringQueue(redisUrl);
  const okfEmbeddingQueue = getOkfConceptEmbeddingQueue();
  const bulkTopicApprovalQueue = createBulkTopicApprovalQueue(redisUrl);
  const relationVerificationQueue = createOkfRelationVerificationQueue(redisUrl);

  await reconcileQueuedJobs(repository, queue);
  await reconcileQueuedRagJobs(ragRepository, ragQueue);
  await reconcileQueuedTopicDiscoveryJobs(repository, topicDiscoveryQueue);
  const continuationDocuments = await enqueuePendingTopicContinuationReconciliations(
    topicContinuationQueue.enqueue,
  );
  if (continuationDocuments > 0) {
    console.log(`Queued continuation reconciliation for ${continuationDocuments} documents.`);
  }
  await reconcileQueuedKnowledgeAuthoringRuns(repository, knowledgeAuthoringQueue);
  await reconcileOkfConceptEmbeddings({
    queue: okfEmbeddingQueue,
    repository: createOkfConceptEmbeddingRepository(),
  });
  await reconcileBulkTopicApprovalRuns(bulkTopicApprovalQueue.enqueue);
  await reconcileDocumentDeletionJobs(enqueueDocumentDeletionJob);
  await reconcileKnowledgeBundleDeletionJobs(enqueueKnowledgeBundleDeletionJob);
  await reconcileOkfRelationVerificationJobs(relationVerificationQueue);

  extractionWorker = new Worker<ExtractionJobPayload>(
    "extraction",
    async (job) => {
      await runProductionExtractionJob(job.data, {
        ragQueue,
        repository,
        storage,
        knowledgeAuthoringQueue,
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

  topicDiscoveryWorker = new Worker<TopicDiscoveryJobPayload>(
    "topic-discovery",
    async (job) => runTopicDiscoveryJob(job.data),
    {
      concurrency: Number(process.env.TOPIC_DISCOVERY_WORKER_CONCURRENCY ?? "1"),
      connection: { url: redisUrl },
    },
  );

  topicContinuationWorker = new Worker<TopicContinuationReconciliationPayload>(
    "topic-continuation-reconciliation",
    async (job) => runTopicContinuationReconciliation(job.data),
    { concurrency: 1, connection: { url: redisUrl } },
  );

  knowledgeAuthoringWorker = new Worker<KnowledgeAuthoringJobPayload>(
    "knowledge-authoring",
    async (job) => {
      const result = await runKnowledgeAuthoringJob(job.data);
      if (result.status === "ready_for_review") {
        await createAutomaticBulkApprovalRun({
          authoringRunId: result.id,
          enqueue: bulkTopicApprovalQueue.enqueue,
        });
      }
      return result;
    },
    {
      concurrency: Number(process.env.KNOWLEDGE_AUTHORING_WORKER_CONCURRENCY ?? "1"),
      connection: { url: redisUrl },
    },
  );

  bundleDeletionWorker = new Worker<KnowledgeBundleDeletionJobPayload>(
    "knowledge-bundle-deletion",
    async (job) => runKnowledgeBundleDeletionJob(job.data),
    { concurrency: 1, connection: { url: redisUrl } },
  );

  okfEmbeddingWorker = new Worker<OkfConceptEmbeddingJobPayload>(
    "okf-concept-embedding",
    async (job) => runOkfConceptEmbeddingJob(job.data),
    { concurrency: 1, connection: { url: redisUrl } },
  );

  bulkTopicApprovalWorker = new Worker<BulkTopicApprovalJobPayload>(
    "bulk-topic-approval",
    async (job) => runBulkTopicApprovalJob(job.data),
    { concurrency: 1, connection: { url: redisUrl } },
  );

  documentDeletionWorker = new Worker<DocumentDeletionJobPayload>(
    "document-deletion",
    async (job) => runPermanentDocumentDeletionJob(job.data, { storage }),
    { concurrency: 1, connection: { url: redisUrl } },
  );

  relationVerificationWorker = new Worker<OkfRelationVerificationJobPayload>(
    "okf-relation-verification",
    async (job) => runOkfRelationVerificationJob(job.data, { attemptNumber: job.attemptsMade + 1 }),
    { concurrency: 1, connection: { url: redisUrl } },
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
  bundleDeletionWorker.on("failed", (job, error) => {
    console.error(`Knowledge bundle deletion failed: ${job?.id ?? "unknown"}`, error);
  });
  topicDiscoveryWorker.on("completed", (job) => {
    console.log(`Topic discovery job completed: ${job.id}`);
  });
  topicDiscoveryWorker.on("failed", (job, error) => {
    console.error(`Topic discovery job failed: ${job?.id ?? "unknown"}`, error);
  });
  topicContinuationWorker.on("completed", (job, result) => {
    console.log(
      `Topic continuation reconciliation completed: ${job.id} (${result.changedTopics} changed)`,
    );
  });
  topicContinuationWorker.on("failed", (job, error) => {
    console.error(`Topic continuation reconciliation failed: ${job?.id ?? "unknown"}`, error);
  });
  knowledgeAuthoringWorker.on("completed", (job) => {
    console.log(`Knowledge authoring run completed: ${job.id}`);
  });
  knowledgeAuthoringWorker.on("failed", (job, error) => {
    console.error(`Knowledge authoring run failed: ${job?.id ?? "unknown"}`, error);
  });
  okfEmbeddingWorker.on("failed", (job, error) => {
    console.error(`OKF concept embedding job failed: ${job?.id ?? "unknown"}`, error);
  });
  bulkTopicApprovalWorker.on("failed", (job, error) => {
    console.error(`Bulk topic approval job failed: ${job?.id ?? "unknown"}`, error);
  });
  documentDeletionWorker.on("failed", (job, error) => {
    console.error(`Document deletion failed: ${job?.id ?? "unknown"}`, error);
  });
  relationVerificationWorker.on("failed", (job, error) => {
    console.error(`OKF relation verification failed: ${job?.id ?? "unknown"}`, error);
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
      chunkingStrategyId: getDefaultChunkingStrategyId(),
      documentId: job.documentId,
      indexJobId: job.id,
      indexVersion: job.indexVersion,
      mode: "initial",
      workspaceId: job.workspaceId,
    });
  }

  if (jobs.length > 0) {
    console.log(`Re-enqueued ${jobs.length} RAG index jobs.`);
  }
}

async function reconcileQueuedTopicDiscoveryJobs(
  repository: ReturnType<typeof createPostgresDocumentRepository>,
  queue: ReturnType<typeof createBullMqTopicDiscoveryQueue>,
) {
  const jobs = await repository.getQueuedTopicDiscoveryJobs();
  for (const job of jobs) {
    await queue.enqueue({
      documentId: job.documentId,
      topicDiscoveryJobId: job.id,
      workspaceId: job.workspaceId,
    });
  }
  if (jobs.length > 0) console.log(`Re-enqueued ${jobs.length} topic discovery jobs.`);
}

async function reconcileQueuedKnowledgeAuthoringRuns(
  repository: ReturnType<typeof createPostgresDocumentRepository>,
  queue: ReturnType<typeof createBullMqKnowledgeAuthoringQueue>,
) {
  const jobs = await repository.getQueuedKnowledgeAuthoringRuns();
  for (const job of jobs) {
    await queue.enqueue({ documentId: job.documentId, runId: job.id, workspaceId: job.workspaceId });
  }
  if (jobs.length > 0) console.log(`Re-enqueued ${jobs.length} knowledge authoring runs.`);
}

async function shutdown() {
  await extractionWorker?.close();
  await ragWorker?.close();
  await bundleDeletionWorker?.close();
  await topicDiscoveryWorker?.close();
  await topicContinuationWorker?.close();
  await knowledgeAuthoringWorker?.close();
  await okfEmbeddingWorker?.close();
  await bulkTopicApprovalWorker?.close();
  await documentDeletionWorker?.close();
  await relationVerificationWorker?.close();
  process.exit(0);
}

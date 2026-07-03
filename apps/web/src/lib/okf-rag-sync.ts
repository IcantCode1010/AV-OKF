import { createHash } from "node:crypto";

import {
  getEmbeddingProvider,
  type EmbeddingProvider,
} from "./embedding-provider.ts";
import { createRagRepository, type RagRepository } from "./rag-repository.ts";
import type { EmbeddingBudgetCaps } from "./rag-budget.ts";
import { getTokenCounter, type TokenCounter } from "./rag-tokenizer.ts";
import type { RagChunkRecord } from "./rag-types.ts";

export const OKF_TOPIC_CHUNKING_STRATEGY_ID = "okf-topic-v1";
export const OKF_TOPIC_SOURCE_TYPE = "okf_topic";

export type OkfRagSyncTopic = {
  approvedContentSource: string | null;
  documentId: string;
  enrichedSummary: string | null;
  enrichedTitle: string | null;
  id: string;
  originalSummary: string;
  originalTitle: string;
  pageEnd: number;
  pageStart: number;
  sourcePageNumbers: number[];
  summary: string;
  title: string;
  workspaceId: string;
};

export type OkfSyncedChunkLookup = {
  contentHash: string;
  documentId: string;
  id: string;
  sourceTopicId: string | null;
  workspaceId: string;
};

export type OkfRagSyncRepository = Pick<
  RagRepository,
  | "completeOkfSyncJob"
  | "createOkfSyncIndexJob"
  | "deleteOkfSyncedChunks"
  | "failOkfSyncJob"
  | "getOkfSyncedChunksForTopics"
  | "listApprovedTopicsForRagSync"
  | "storeOkfSyncedChunk"
>;

export type OkfRagSyncResultItem = {
  documentId: string;
  reason?: string;
  status: "synced" | "skipped-unchanged" | "failed";
  topicId: string;
};

export type OkfRagSyncResult = {
  failed: number;
  results: OkfRagSyncResultItem[];
  skippedUnchanged: number;
  synced: number;
};

type SyncApprovedTopicsOptions = {
  budgetCaps?: EmbeddingBudgetCaps;
  embeddingProvider?: EmbeddingProvider;
  repository?: OkfRagSyncRepository;
  tokenCounter?: TokenCounter;
};

export async function syncApprovedTopicsToRag(
  workspaceId: string,
  options: SyncApprovedTopicsOptions = {},
): Promise<OkfRagSyncResult> {
  const repository = options.repository ?? createRagRepository();
  const embeddingProvider = options.embeddingProvider ?? getEmbeddingProvider();
  const tokenCounter = options.tokenCounter ?? getTokenCounter();
  const topics = (await repository.listApprovedTopicsForRagSync({
    workspaceId,
  })) as OkfRagSyncTopic[];
  const existingChunks = await repository.getOkfSyncedChunksForTopics({
    sourceTopicIds: topics.map((topic) => topic.id),
    workspaceId,
  });
  const existingByTopic = new Map(
    existingChunks
      .filter((chunk) => chunk.sourceTopicId)
      .map((chunk) => [chunk.sourceTopicId as string, chunk]),
  );
  const results: OkfRagSyncResultItem[] = [];

  for (const topic of topics) {
    const text = buildTopicChunkText(topic);
    const contentHash = hashText(text);
    const existing = existingByTopic.get(topic.id);

    if (existing?.contentHash === contentHash) {
      results.push({
        documentId: topic.documentId,
        status: "skipped-unchanged",
        topicId: topic.id,
      });
      continue;
    }

    let job: Awaited<
      ReturnType<OkfRagSyncRepository["createOkfSyncIndexJob"]>
    > | null = null;

    try {
      const tokenCount = tokenCounter.count(text);
      job = await repository.createOkfSyncIndexJob({
        caps: options.budgetCaps,
        documentId: topic.documentId,
        tokenEstimate: tokenCount,
        workspaceId,
      });
      const [embedding] = await embeddingProvider.embedTexts([text]);

      if (!embedding) {
        throw new Error("okf_rag_sync_missing_embedding");
      }

      await repository.deleteOkfSyncedChunks({
        documentId: topic.documentId,
        sourceTopicId: topic.id,
        workspaceId,
      });
      await repository.storeOkfSyncedChunk({
        chunk: buildTopicChunk({
          contentHash,
          indexJobId: job.id,
          indexVersion: job.indexVersion,
          text,
          tokenCount,
          topic,
        }),
        embedding,
        model: embeddingProvider.model,
      });
      await repository.completeOkfSyncJob({ indexJobId: job.id });
      results.push({
        documentId: topic.documentId,
        status: "synced",
        topicId: topic.id,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (job) {
        await repository.failOkfSyncJob({
          errorMessage: message,
          indexJobId: job.id,
        });
      }

      results.push({
        documentId: topic.documentId,
        reason: message,
        status: "failed",
        topicId: topic.id,
      });
    }
  }

  return summarizeResults(results);
}

function buildTopicChunkText(topic: OkfRagSyncTopic) {
  return [topic.title.trim(), topic.summary.trim()]
    .filter((part) => part.length > 0)
    .join("\n\n");
}

function buildTopicChunk(input: {
  contentHash: string;
  indexJobId: string;
  indexVersion: number;
  text: string;
  tokenCount: number;
  topic: OkfRagSyncTopic;
}): RagChunkRecord {
  return {
    chunkOrdinal: 0,
    chunkingStrategyId: OKF_TOPIC_CHUNKING_STRATEGY_ID,
    contentHash: input.contentHash,
    documentId: input.topic.documentId,
    headingPath: [input.topic.title],
    id: `okf_${input.topic.id}_${input.contentHash.slice(0, 16)}`,
    indexJobId: input.indexJobId,
    indexVersion: input.indexVersion,
    pageEnd: input.topic.pageEnd,
    pageStart: input.topic.pageStart,
    reviewStatus: "approved",
    sourcePageNumbers: input.topic.sourcePageNumbers,
    sourceTopicId: input.topic.id,
    sourceType: OKF_TOPIC_SOURCE_TYPE,
    text: input.text,
    tokenCount: input.tokenCount,
    workspaceId: input.topic.workspaceId,
  };
}

function summarizeResults(results: OkfRagSyncResultItem[]): OkfRagSyncResult {
  return {
    failed: results.filter((result) => result.status === "failed").length,
    results,
    skippedUnchanged: results.filter(
      (result) => result.status === "skipped-unchanged",
    ).length,
    synced: results.filter((result) => result.status === "synced").length,
  };
}

function hashText(text: string) {
  return createHash("sha256").update(text).digest("hex");
}

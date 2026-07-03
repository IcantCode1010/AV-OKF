import assert from "node:assert/strict";
import test from "node:test";

import { runRagIndexJob } from "./rag-indexer.ts";
import {
  OKF_TOPIC_CHUNKING_STRATEGY_ID,
  syncApprovedTopicsToRag,
  type OkfRagSyncRepository,
} from "./okf-rag-sync.ts";
import type { EmbeddingProvider } from "./embedding-provider.ts";
import type { RagChunkRecord } from "./rag-types.ts";

test("syncApprovedTopicsToRag writes one OKF chunk per approved topic using current title and summary", async () => {
  const repository = createSyncRepository({
    topics: [
      createTopic({
        enrichedSummary: "Historic enriched summary",
        enrichedTitle: "Historic enriched title",
        originalSummary: "Original summary",
        originalTitle: "Original title",
        summary: "Current approved summary",
        title: "Current approved title",
      }),
    ],
  });

  const result = await syncApprovedTopicsToRag("wrk_1", {
    embeddingProvider: deterministicProvider,
    repository,
  });

  assert.deepEqual(
    result.results.map((item) => item.status),
    ["synced"],
  );
  assert.equal(repository.storedChunks.length, 1);
  assert.equal(
    repository.storedChunks[0]?.text,
    "Current approved title\n\nCurrent approved summary",
  );
  assert.equal(repository.storedChunks[0]?.sourceType, "okf_topic");
  assert.equal(repository.storedChunks[0]?.sourceTopicId, "topic_1");
  assert.equal(repository.storedChunks[0]?.reviewStatus, "approved");
  assert.equal(
    repository.storedChunks[0]?.chunkingStrategyId,
    OKF_TOPIC_CHUNKING_STRATEGY_ID,
  );
  assert.equal(repository.storedChunks[0]?.chunkOrdinal, 0);
});

test("syncApprovedTopicsToRag rerun with unchanged topic skips without duplicate chunks or embeddings", async () => {
  const topic = createTopic({});
  const repository = createSyncRepository({ topics: [topic] });

  const first = await syncApprovedTopicsToRag("wrk_1", {
    embeddingProvider: deterministicProvider,
    repository,
  });
  const second = await syncApprovedTopicsToRag("wrk_1", {
    embeddingProvider: {
      ...deterministicProvider,
      async embedTexts() {
        throw new Error("provider_should_not_be_called_for_unchanged_topic");
      },
    },
    repository,
  });

  assert.equal(first.synced, 1);
  assert.equal(second.skippedUnchanged, 1);
  assert.equal(repository.storedChunks.length, 1);
  assert.equal(repository.embeddingRows, 1);
});

test("syncApprovedTopicsToRag syncs raw-only approved topics", async () => {
  const repository = createSyncRepository({
    topics: [
      createTopic({
        approvedContentSource: "raw",
        enrichedSummary: null,
        enrichedTitle: null,
        summary: "Raw approved summary",
        title: "Raw approved title",
      }),
    ],
  });

  await syncApprovedTopicsToRag("wrk_1", {
    embeddingProvider: deterministicProvider,
    repository,
  });

  assert.equal(
    repository.storedChunks[0]?.text,
    "Raw approved title\n\nRaw approved summary",
  );
});

test("syncApprovedTopicsToRag only requests approved topics for the calling workspace", async () => {
  const requestedWorkspaces: string[] = [];
  const repository = createSyncRepository({
    listApprovedTopicsForRagSync: async (input) => {
      requestedWorkspaces.push(input.workspaceId);
      return [createTopic({ workspaceId: input.workspaceId })];
    },
  });

  await syncApprovedTopicsToRag("wrk_allowed", {
    embeddingProvider: deterministicProvider,
    repository,
  });

  assert.deepEqual(requestedWorkspaces, ["wrk_allowed"]);
  assert.deepEqual(
    repository.storedChunks.map((chunk) => chunk.workspaceId),
    ["wrk_allowed"],
  );
});

test("OKF topic chunks survive document reindex while raw extraction chunks are replaced", async () => {
  const repository = createSyncRepository({
    rawChunks: [
      createStoredChunk({
        id: "raw_old",
        sourceTopicId: null,
        sourceType: "raw_extraction",
      }),
    ],
    topics: [createTopic({})],
  });

  await syncApprovedTopicsToRag("wrk_1", {
    embeddingProvider: deterministicProvider,
    repository,
  });

  await runRagIndexJob(
    {
      chunkingStrategyId: "paragraph-v1",
      documentId: "doc_1",
      indexJobId: "raw_job_2",
      indexVersion: 2,
      mode: "reindex",
      workspaceId: "wrk_1",
    },
    {
      chunkPages: () => [
        {
          chunkOrdinal: 0,
          contentHash: "raw-new-hash",
          documentId: "doc_1",
          headingPath: [],
          id: "raw_new",
          indexJobId: "raw_job_2",
          indexVersion: 2,
          pageEnd: 1,
          pageStart: 1,
          reviewStatus: "raw_extracted",
          sourcePageNumbers: [1],
          sourceType: "raw_extraction",
          text: "new raw chunk",
          tokenCount: 3,
          workspaceId: "wrk_1",
        },
      ],
      embeddingProvider: deterministicProvider,
      repository,
    },
  );

  assert.deepEqual(
    repository.rawChunks.map((chunk) => chunk.id),
    ["raw_new"],
  );
  assert.deepEqual(
    repository.okfChunks.map((chunk) => chunk.sourceTopicId),
    ["topic_1"],
  );
});

function createSyncRepository(
  overrides: Partial<OkfRagSyncRepository> & {
    rawChunks?: StoredChunk[];
    topics?: SyncTopic[];
  },
) {
  const topics = overrides.topics ?? [];
  const existingByTopic = new Map<string, StoredChunk>();
  const repository = {
    embeddingRows: 0,
    okfChunks: [] as StoredChunk[],
    rawChunks: overrides.rawChunks ?? [],
    storedChunks: [] as StoredChunk[],
    async completeOkfSyncJob() {},
    async createOkfSyncIndexJob(input: {
      documentId: string;
      tokenEstimate: number;
      workspaceId: string;
    }) {
      return {
        documentId: input.documentId,
        id: `okf_job_${input.documentId}_${repository.storedChunks.length + 1}`,
        indexVersion: repository.storedChunks.length + 100,
        workspaceId: input.workspaceId,
      };
    },
    async deleteChunksForDocument(input: {
      documentId: string;
      workspaceId: string;
    }) {
      repository.rawChunks = repository.rawChunks.filter(
        (chunk) =>
          chunk.documentId !== input.documentId ||
          chunk.workspaceId !== input.workspaceId,
      );
    },
    async deleteOkfSyncedChunks(input: {
      documentId: string;
      sourceTopicId?: string;
      workspaceId: string;
    }) {
      repository.okfChunks = repository.okfChunks.filter(
        (chunk) =>
          chunk.documentId !== input.documentId ||
          chunk.workspaceId !== input.workspaceId ||
          (input.sourceTopicId && chunk.sourceTopicId !== input.sourceTopicId),
      );
      if (input.sourceTopicId) {
        existingByTopic.delete(input.sourceTopicId);
      }
    },
    async failIndexJob() {},
    async failOkfSyncJob() {},
    async getExtractedPages() {
      return [];
    },
    async getOkfSyncedChunksForTopics() {
      return Array.from(existingByTopic.values());
    },
    async getTokenUsageToday() {
      return {
        globalTokensUsedToday: 0,
        workspaceTokensUsedToday: 0,
      };
    },
    async listApprovedTopicsForRagSync(input: { workspaceId: string }) {
      return topics.filter((topic) => topic.workspaceId === input.workspaceId);
    },
    async markDocumentRagStatus() {},
    async markIndexJobRunning() {},
    async reserveIndexJobBudget() {},
    async storeCompletedIndex(input: {
      chunks: RagChunkRecord[];
      embeddings: number[][];
    }) {
      repository.rawChunks = [];
      for (const chunk of input.chunks) {
        repository.rawChunks.push(createStoredChunk(chunk));
      }
      repository.embeddingRows += input.embeddings.length;
    },
    async storeOkfSyncedChunk(input: {
      chunk: RagChunkRecord;
      embedding: number[];
    }) {
      const stored = createStoredChunk(input.chunk);
      if (input.chunk.sourceType === "okf_topic" && input.chunk.sourceTopicId) {
        repository.okfChunks.push(stored);
        existingByTopic.set(input.chunk.sourceTopicId, stored);
      } else {
        repository.rawChunks.push(stored);
      }
      repository.storedChunks.push(stored);
      repository.embeddingRows += 1;
    },
    ...overrides,
  } satisfies OkfRagSyncRepository & {
    embeddingRows: number;
    okfChunks: StoredChunk[];
    rawChunks: StoredChunk[];
    storedChunks: StoredChunk[];
  };

  return repository;
}

const deterministicProvider: EmbeddingProvider = {
  dimensions: 3,
  model: "test-embedding",
  async embedTexts(input) {
    return input.map(() => [0.1, 0.2, 0.3]);
  },
};

type SyncTopic = Awaited<
  ReturnType<OkfRagSyncRepository["listApprovedTopicsForRagSync"]>
>[number];

type StoredChunk = RagChunkRecord & {
  sourceTopicId: string | null;
  sourceType: string;
};

function createTopic(overrides: Partial<SyncTopic>): SyncTopic {
  return {
    approvedContentSource: "enriched",
    documentId: "doc_1",
    enrichedSummary: "Enriched summary",
    enrichedTitle: "Enriched title",
    id: "topic_1",
    originalSummary: "Original summary",
    originalTitle: "Original title",
    pageEnd: 4,
    pageStart: 3,
    sourcePageNumbers: [3, 4],
    summary: "Approved summary",
    title: "Approved title",
    workspaceId: "wrk_1",
    ...overrides,
  };
}

function createStoredChunk(overrides: Partial<StoredChunk>): StoredChunk {
  return {
    chunkOrdinal: 0,
    chunkingStrategyId: overrides.chunkingStrategyId ?? null,
    contentHash: overrides.contentHash ?? "hash",
    documentId: "doc_1",
    headingPath: [],
    id: "chunk_1",
    indexJobId: "job_1",
    indexVersion: 1,
    pageEnd: 1,
    pageStart: 1,
    reviewStatus: "raw_extracted",
    sourcePageNumbers: [1],
    sourceTopicId: null,
    sourceType: "raw_extraction",
    text: "chunk text",
    tokenCount: 2,
    workspaceId: "wrk_1",
    ...overrides,
  };
}

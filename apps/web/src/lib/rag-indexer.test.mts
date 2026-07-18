import assert from "node:assert/strict";
import test from "node:test";

import { UnrecoverableError } from "bullmq";

import { runRagIndexJob } from "./rag-indexer.ts";
import {
  EmbeddingBudgetExceededError,
  assertEmbeddingBudget,
} from "./rag-budget.ts";

test("runRagIndexJob checks budget before embedding provider call", async () => {
  let providerCalled = false;
  let failureCode = "";

  await assert.rejects(
    () =>
      runRagIndexJob(
        {
          documentId: "doc_1",
          indexJobId: "job_1",
          indexVersion: 1,
          workspaceId: "wrk_1",
        },
        {
          budgetCaps: {
            globalTokensPerDay: 100,
            tokensPerDocument: 10,
            workspaceTokensPerDay: 100,
          },
          chunkPages: () => [
            {
              chunkOrdinal: 0,
              contentHash: "hash",
              documentId: "doc_1",
              headingPath: [],
              id: "rag_doc_1_1_1_0_hash",
              indexJobId: "job_1",
              indexVersion: 1,
              pageEnd: 1,
              pageStart: 1,
              reviewStatus: "raw_extracted",
              sourcePageNumbers: [1],
              text: "too many tokens",
              tokenCount: 11,
              workspaceId: "wrk_1",
            },
          ],
          embeddingProvider: {
            dimensions: 1536,
            model: "test",
            async embedTexts() {
              providerCalled = true;
              return [];
            },
          },
          repository: {
            failIndexJob: async (input: { errorCode: string }) => {
              failureCode = input.errorCode;
            },
            getExtractedPages: async () => [],
            getTokenUsageToday: async () => ({
              globalTokensUsedToday: 0,
              workspaceTokensUsedToday: 0,
            }),
            markIndexJobRunning: async () => {},
            storeCompletedIndex: async () => {},
          },
        },
      ),
    (error) =>
      error instanceof UnrecoverableError &&
      /embedding_budget_exceeded/.test(error.message),
  );

  assert.equal(providerCalled, false);
  assert.equal(failureCode, "embedding_budget_exceeded");
});

test("runRagIndexJob stores completed index when embedding succeeds", async () => {
  let storedChunks = 0;
  let embeddedInput: string[] = [];

  await runRagIndexJob(
    {
      documentId: "doc_1",
      indexJobId: "job_1",
      indexVersion: 1,
      workspaceId: "wrk_1",
    },
    {
      chunkPages: () => [
        {
          chunkOrdinal: 0,
          contentHash: "hash",
          documentId: "doc_1",
          headingPath: [],
          id: "rag_doc_1_1_1_0_hash",
          indexJobId: "job_1",
          indexVersion: 1,
          pageEnd: 1,
          pageStart: 1,
          reviewStatus: "raw_extracted",
          sourcePageNumbers: [1],
          text: "generator control",
          embeddingText: "[Document: Generator Manual | Section: Control | Pages: 1]\ngenerator control",
          tokenCount: 2,
          workspaceId: "wrk_1",
        },
      ],
      embeddingProvider: {
        dimensions: 1536,
        model: "test",
        async embedTexts(input: string[]) {
          embeddedInput = input;
          return input.map(() => Array.from({ length: 1536 }, () => 0.01));
        },
      },
      repository: {
        failIndexJob: async () => {},
        getExtractedPages: async () => [],
        getTokenUsageToday: async () => ({
          globalTokensUsedToday: 0,
          workspaceTokensUsedToday: 0,
        }),
        markIndexJobRunning: async () => {},
        storeCompletedIndex: async (input: { chunks: unknown[] }) => {
          storedChunks = input.chunks.length;
        },
      },
    },
  );

  assert.equal(storedChunks, 1);
  assert.deepEqual(embeddedInput, ["[Document: Generator Manual | Section: Control | Pages: 1]\ngenerator control"]);
});

test("runRagIndexJob reindex deletes old chunks before storing fresh strategy-labeled chunks", async () => {
  const calls: string[] = [];
  let storedChunkIds: string[] = ["old_chunk_a", "old_chunk_b"];
  let storedStrategyIds: Array<string | null | undefined> = [];

  await runRagIndexJob(
    {
      chunkingStrategyId: "paragraph-v1",
      documentId: "doc_1",
      indexJobId: "job_2",
      indexVersion: 2,
      mode: "reindex",
      workspaceId: "wrk_1",
    },
    {
      chunkPages: () => [
        createTestChunk({ id: "new_chunk_a", indexJobId: "job_2", indexVersion: 2 }),
        createTestChunk({
          chunkOrdinal: 1,
          id: "new_chunk_b",
          indexJobId: "job_2",
          indexVersion: 2,
        }),
      ],
      embeddingProvider: {
        dimensions: 1536,
        model: "test",
        async embedTexts(input: string[]) {
          calls.push("embedding");
          return input.map(() => Array.from({ length: 1536 }, () => 0.01));
        },
      },
      repository: {
        deleteChunksForDocument: async () => {
          calls.push("delete");
          storedChunkIds = [];
        },
        failIndexJob: async () => {},
        getExtractedPages: async () => [],
        getTokenUsageToday: async () => ({
          globalTokensUsedToday: 0,
          workspaceTokensUsedToday: 0,
        }),
        markIndexJobRunning: async () => {
          calls.push("mark");
        },
        storeCompletedIndex: async (input: {
          chunks: Array<{ chunkingStrategyId?: string | null; id: string }>;
        }) => {
          calls.push("store");
          storedChunkIds.push(...input.chunks.map((chunk) => chunk.id));
          storedStrategyIds = input.chunks.map((chunk) => chunk.chunkingStrategyId);
        },
      },
    },
  );

  assert.deepEqual(calls, ["mark", "embedding", "delete", "store"]);
  assert.deepEqual(storedChunkIds, ["new_chunk_a", "new_chunk_b"]);
  assert.deepEqual(storedStrategyIds, ["paragraph-v1", "paragraph-v1"]);
});

test("runRagIndexJob initial indexing does not delete existing chunks", async () => {
  let deleteCalled = false;

  await runRagIndexJob(
    {
      chunkingStrategyId: "paragraph-v1",
      documentId: "doc_1",
      indexJobId: "job_1",
      indexVersion: 1,
      mode: "initial",
      workspaceId: "wrk_1",
    },
    {
      chunkPages: () => [createTestChunk({})],
      embeddingProvider: {
        dimensions: 1536,
        model: "test",
        async embedTexts(input: string[]) {
          return input.map(() => Array.from({ length: 1536 }, () => 0.01));
        },
      },
      repository: {
        deleteChunksForDocument: async () => {
          deleteCalled = true;
        },
        failIndexJob: async () => {},
        getExtractedPages: async () => [],
        getTokenUsageToday: async () => ({
          globalTokensUsedToday: 0,
          workspaceTokensUsedToday: 0,
        }),
        markIndexJobRunning: async () => {},
        storeCompletedIndex: async () => {},
      },
    },
  );

  assert.equal(deleteCalled, false);
});

test("runRagIndexJob failed reindex before deletion leaves old chunks retryable", async () => {
  let deleteCalled = false;
  let failureCode = "";
  const existingChunkIds = ["old_chunk_a", "old_chunk_b"];

  await assert.rejects(
    () =>
      runRagIndexJob(
        {
          chunkingStrategyId: "paragraph-v1",
          documentId: "doc_1",
          indexJobId: "job_2",
          indexVersion: 2,
          mode: "reindex",
          workspaceId: "wrk_1",
        },
        {
          chunkPages: () => [createTestChunk({ id: "new_chunk_a" })],
          embeddingProvider: {
            dimensions: 1536,
            model: "test",
            async embedTexts() {
              throw new Error("provider timeout");
            },
          },
          repository: {
            deleteChunksForDocument: async () => {
              deleteCalled = true;
              existingChunkIds.length = 0;
            },
            failIndexJob: async (input: { errorCode: string }) => {
              failureCode = input.errorCode;
            },
            getExtractedPages: async () => [],
            getTokenUsageToday: async () => ({
              globalTokensUsedToday: 0,
              workspaceTokensUsedToday: 0,
            }),
            markIndexJobRunning: async () => {},
            storeCompletedIndex: async () => {},
          },
        },
      ),
    /provider timeout/,
  );

  assert.equal(deleteCalled, false);
  assert.deepEqual(existingChunkIds, ["old_chunk_a", "old_chunk_b"]);
  assert.equal(failureCode, "indexing_failed");
});

test("runRagIndexJob uses repository budget reservation when available", async () => {
  const calls: string[] = [];

  await runRagIndexJob(
    {
      documentId: "doc_1",
      indexJobId: "job_1",
      indexVersion: 1,
      workspaceId: "wrk_1",
    },
    {
      budgetCaps: {
        globalTokensPerDay: 100,
        tokensPerDocument: 100,
        workspaceTokensPerDay: 100,
      },
      chunkPages: () => [
        {
          chunkOrdinal: 0,
          contentHash: "hash",
          documentId: "doc_1",
          headingPath: [],
          id: "rag_doc_1_1_1_0_hash",
          indexJobId: "job_1",
          indexVersion: 1,
          pageEnd: 1,
          pageStart: 1,
          reviewStatus: "raw_extracted",
          sourcePageNumbers: [1],
          text: "generator control",
          tokenCount: 2,
          workspaceId: "wrk_1",
        },
      ],
      embeddingProvider: {
        dimensions: 1536,
        model: "test",
        async embedTexts(input: string[]) {
          calls.push("provider");
          return input.map(() => Array.from({ length: 1536 }, () => 0.01));
        },
      },
      repository: {
        failIndexJob: async () => {},
        getExtractedPages: async () => [],
        getTokenUsageToday: async () => {
          calls.push("usage");
          return {
            globalTokensUsedToday: 0,
            workspaceTokensUsedToday: 0,
          };
        },
        markIndexJobRunning: async () => {
          calls.push("mark");
        },
        reserveIndexJobBudget: async (input: { tokenEstimate: number }) => {
          calls.push(`reserve:${input.tokenEstimate}`);
        },
        storeCompletedIndex: async () => {
          calls.push("store");
        },
      },
    },
  );

  assert.deepEqual(calls, ["reserve:2", "provider", "store"]);
});

test("runRagIndexJob budget reservation prevents concurrent workspace cap overshoot", async () => {
  let providerCalls = 0;
  let reservedTokens = 90;
  let storedTokens = 0;
  const repository = {
    failIndexJob: async () => {},
    getExtractedPages: async () => [],
    getTokenUsageToday: async () => ({
      globalTokensUsedToday: reservedTokens,
      workspaceTokensUsedToday: reservedTokens,
    }),
    markIndexJobRunning: async () => {},
    reserveIndexJobBudget: async (input: {
      caps: {
        globalTokensPerDay: number;
        tokensPerDocument: number;
        workspaceTokensPerDay: number;
      };
      tokenEstimate: number;
    }) => {
      try {
        assertEmbeddingBudget(
          {
            documentTokenEstimate: input.tokenEstimate,
            globalTokensUsedToday: reservedTokens,
            workspaceTokensUsedToday: reservedTokens,
          },
          input.caps,
        );
      } catch (error) {
        if (error instanceof EmbeddingBudgetExceededError) {
          throw error;
        }

        throw error;
      }

      reservedTokens += input.tokenEstimate;
    },
    storeCompletedIndex: async (input: { chunks: Array<{ tokenCount: number }> }) => {
      storedTokens += input.chunks.reduce(
        (sum, chunk) => sum + chunk.tokenCount,
        0,
      );
    },
  };
  const options = {
    budgetCaps: {
      globalTokensPerDay: 100,
      tokensPerDocument: 100,
      workspaceTokensPerDay: 100,
    },
    chunkPages: (input: { documentId: string; indexJobId: string }) => [
      {
        chunkOrdinal: 0,
        contentHash: `hash-${input.indexJobId}`,
        documentId: input.documentId,
        headingPath: [],
        id: `rag_${input.documentId}_1_1_0_hash`,
        indexJobId: input.indexJobId,
        indexVersion: 1,
        pageEnd: 1,
        pageStart: 1,
        reviewStatus: "raw_extracted" as const,
        sourcePageNumbers: [1],
        text: "six tokens indexed concurrently",
        tokenCount: 6,
        workspaceId: "wrk_1",
      },
    ],
    embeddingProvider: {
      dimensions: 1536,
      model: "test",
      async embedTexts(input: string[]) {
        providerCalls += 1;
        return input.map(() => Array.from({ length: 1536 }, () => 0.01));
      },
    },
    repository,
  };

  const results = await Promise.allSettled([
    runRagIndexJob(
      {
        documentId: "doc_1",
        indexJobId: "job_1",
        indexVersion: 1,
        workspaceId: "wrk_1",
      },
      options,
    ),
    runRagIndexJob(
      {
        documentId: "doc_2",
        indexJobId: "job_2",
        indexVersion: 1,
        workspaceId: "wrk_1",
      },
      options,
    ),
  ]);

  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    results.some(
      (result) =>
        result.status === "rejected" &&
        result.reason instanceof UnrecoverableError,
    ),
    true,
  );
  assert.equal(providerCalls, 1);
  assert.equal(storedTokens, 6);
  assert.equal(reservedTokens, 96);
});

test("runRagIndexJob rethrows transient provider failures for BullMQ retry", async () => {
  let failureCode = "";

  await assert.rejects(
    () =>
      runRagIndexJob(
        {
          documentId: "doc_1",
          indexJobId: "job_1",
          indexVersion: 1,
          workspaceId: "wrk_1",
        },
        {
          chunkPages: () => [
            {
              chunkOrdinal: 0,
              contentHash: "hash",
              documentId: "doc_1",
              headingPath: [],
              id: "rag_doc_1_1_1_0_hash",
              indexJobId: "job_1",
              indexVersion: 1,
              pageEnd: 1,
              pageStart: 1,
              reviewStatus: "raw_extracted",
              sourcePageNumbers: [1],
              text: "generator control",
              tokenCount: 2,
              workspaceId: "wrk_1",
            },
          ],
          embeddingProvider: {
            dimensions: 1536,
            model: "test",
            async embedTexts() {
              throw new Error("provider timeout");
            },
          },
          repository: {
            failIndexJob: async (input: { errorCode: string }) => {
              failureCode = input.errorCode;
            },
            getExtractedPages: async () => [],
            getTokenUsageToday: async () => ({
              globalTokensUsedToday: 0,
              workspaceTokensUsedToday: 0,
            }),
            markIndexJobRunning: async () => {},
            storeCompletedIndex: async () => {},
          },
        },
      ),
    /provider timeout/,
  );

  assert.equal(failureCode, "indexing_failed");
});

test("runRagIndexJob marks provider construction failures failed", async () => {
  const previousBackend = process.env.AV_OKF_BACKEND;
  const previousApiKey = process.env.OPENAI_API_KEY;
  let failureCode = "";
  let failureMessage = "";

  try {
    process.env.AV_OKF_BACKEND = "production";
    delete process.env.OPENAI_API_KEY;

    await assert.rejects(
      () =>
        runRagIndexJob(
          {
            documentId: "doc_1",
            indexJobId: "job_1",
            indexVersion: 1,
            workspaceId: "wrk_1",
          },
          {
            chunkPages: () => [createTestChunk({})],
            repository: {
              failIndexJob: async (input: {
                errorCode: string;
                errorMessage: string;
              }) => {
                failureCode = input.errorCode;
                failureMessage = input.errorMessage;
              },
              getExtractedPages: async () => [],
              getTokenUsageToday: async () => ({
                globalTokensUsedToday: 0,
                workspaceTokensUsedToday: 0,
              }),
              markIndexJobRunning: async () => {},
              storeCompletedIndex: async () => {},
            },
          },
        ),
      /missing_env_OPENAI_API_KEY/,
    );

    assert.equal(failureCode, "indexing_failed");
    assert.match(failureMessage, /missing_env_OPENAI_API_KEY/);
  } finally {
    if (previousBackend === undefined) {
      delete process.env.AV_OKF_BACKEND;
    } else {
      process.env.AV_OKF_BACKEND = previousBackend;
    }

    if (previousApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = previousApiKey;
    }
  }
});

function createTestChunk(
  overrides: Partial<{
    chunkOrdinal: number;
    id: string;
    indexJobId: string;
    indexVersion: number;
  }>,
) {
  return {
    chunkOrdinal: overrides.chunkOrdinal ?? 0,
    contentHash: `hash-${overrides.id ?? "new_chunk"}`,
    documentId: "doc_1",
    headingPath: [],
    id: overrides.id ?? "new_chunk",
    indexJobId: overrides.indexJobId ?? "job_1",
    indexVersion: overrides.indexVersion ?? 1,
    pageEnd: 1,
    pageStart: 1,
    reviewStatus: "raw_extracted" as const,
    sourcePageNumbers: [1],
    text: "generator control",
    tokenCount: 2,
    workspaceId: "wrk_1",
  };
}

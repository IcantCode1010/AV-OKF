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
          tokenCount: 2,
          workspaceId: "wrk_1",
        },
      ],
      embeddingProvider: {
        dimensions: 1536,
        model: "test",
        async embedTexts(input: string[]) {
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

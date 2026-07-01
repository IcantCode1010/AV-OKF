import assert from "node:assert/strict";
import test from "node:test";

import { UnrecoverableError } from "bullmq";

import { runRagIndexJob } from "./rag-indexer.ts";

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

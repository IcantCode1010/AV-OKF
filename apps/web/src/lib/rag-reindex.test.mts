import assert from "node:assert/strict";
import test from "node:test";

import {
  formatChunkingStrategyLabel,
  requestDocumentReindex,
} from "./rag-reindex.ts";
import type { AuthWorkspaceContext } from "./auth-workspace.ts";

const context: AuthWorkspaceContext = {
  role: "admin",
  userId: "usr_1",
  workspaceId: "wrk_1",
};

test("formatChunkingStrategyLabel displays unknown for legacy null strategy ids", () => {
  assert.equal(formatChunkingStrategyLabel(null), "unknown");
  assert.equal(formatChunkingStrategyLabel(undefined), "unknown");
  assert.equal(
    formatChunkingStrategyLabel("paragraph-v1"),
    "Paragraph-granular (v1)",
  );
});

test("requestDocumentReindex rejects a second document while one workspace reindex is active", async () => {
  let activeDocumentId: string | null = null;
  const startedDocuments: string[] = [];
  const repository = {
    async createReindexJob(input: {
      chunkingStrategyId: string;
      documentId: string;
      workspaceId: string;
    }) {
      assert.equal(input.chunkingStrategyId, "paragraph-v1");
      assert.equal(input.workspaceId, "wrk_1");

      if (activeDocumentId) {
        throw new Error("reindex_already_running");
      }

      activeDocumentId = input.documentId;
      startedDocuments.push(input.documentId);
      return {
        documentId: input.documentId,
        id: `job_${input.documentId}`,
        indexVersion: startedDocuments.length,
        workspaceId: input.workspaceId,
      };
    },
  };
  const queue = {
    async enqueueIndexJob() {},
  };

  await requestDocumentReindex({
    chunkingStrategyId: "paragraph-v1",
    context,
    documentId: "doc_a",
    queue,
    repository,
  });

  await assert.rejects(
    () =>
      requestDocumentReindex({
        chunkingStrategyId: "paragraph-v1",
        context,
        documentId: "doc_b",
        queue,
        repository,
      }),
    /reindex_already_running/,
  );

  activeDocumentId = null;

  await requestDocumentReindex({
    chunkingStrategyId: "paragraph-v1",
    context,
    documentId: "doc_b",
    queue,
    repository,
  });

  assert.deepEqual(startedDocuments, ["doc_a", "doc_b"]);
});

test("requestDocumentReindex does not enqueue documents outside the workspace", async () => {
  let enqueued = false;

  await assert.rejects(
    () =>
      requestDocumentReindex({
        chunkingStrategyId: "paragraph-v1",
        context,
        documentId: "doc_foreign",
        queue: {
          async enqueueIndexJob() {
            enqueued = true;
          },
        },
        repository: {
          async createReindexJob() {
            throw new Error("document_not_found");
          },
        },
      }),
    /document_not_found/,
  );

  assert.equal(enqueued, false);
});

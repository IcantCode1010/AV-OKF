import assert from "node:assert/strict";
import test from "node:test";

import { createPostgresDocumentRepository } from "./production-repository.ts";

test("production topic content edit rejects cross-workspace topics", async () => {
  const repository = createPostgresDocumentRepository({
    topicRecord: {
      findFirst: async () => null,
      update: async () => {
        throw new Error("update_should_not_run");
      },
    },
  });

  await assert.rejects(
    () =>
      repository.updateTopicContent({
        context: { role: "admin", userId: "usr_1", workspaceId: "wrk_1" },
        editedBy: "usr_1",
        summary: "Edited summary",
        title: "Edited title",
        topicId: "topic_other_workspace",
      }),
    /topic_not_found/,
  );
});

test("production document reads exclude soft-deleted documents", async () => {
  const findManyCalls: unknown[] = [];
  const findFirstCalls: unknown[] = [];
  const repository = createPostgresDocumentRepository({
    document: {
      findFirst: async (input: unknown) => {
        findFirstCalls.push(input);
        return null;
      },
      findMany: async (input: unknown) => {
        findManyCalls.push(input);
        return [];
      },
    },
  });

  await assert.rejects(
    () =>
      repository.getDocumentById({
        context: { role: "admin", userId: "usr_1", workspaceId: "wrk_1" },
        documentId: "doc_deleted",
      }),
    /document_not_found/,
  );
  await repository.getDocuments({
    role: "admin",
    userId: "usr_1",
    workspaceId: "wrk_1",
  });
  await repository.getDocumentMetrics({
    role: "admin",
    userId: "usr_1",
    workspaceId: "wrk_1",
  });

  assert.equal(
    findFirstCalls.some((call) =>
      JSON.stringify(call).includes('"deletedAt":null'),
    ),
    true,
  );
  assert.equal(
    findManyCalls.every((call) =>
      JSON.stringify(call).includes('"deletedAt":null'),
    ),
    true,
  );
});

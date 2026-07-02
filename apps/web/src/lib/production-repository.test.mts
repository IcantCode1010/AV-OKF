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

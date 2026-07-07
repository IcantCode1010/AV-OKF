import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  getOkfConceptLifecycleByFile,
  getOkfConceptLifecycleForFile,
  markOkfConceptLifecycle,
  normalizeOkfConceptLifecycleStatus,
  softDeleteDocument,
} from "./okf-lifecycle.ts";

test("normalizeOkfConceptLifecycleStatus recognizes non-trusted lifecycle states", () => {
  assert.equal(normalizeOkfConceptLifecycleStatus("retracted"), "retracted");
  assert.equal(normalizeOkfConceptLifecycleStatus("archived"), "archived");
  assert.equal(normalizeOkfConceptLifecycleStatus("deleted"), "deleted");
});

test("normalizeOkfConceptLifecycleStatus defaults unknown or missing values to active", () => {
  assert.equal(normalizeOkfConceptLifecycleStatus("superseded"), "active");
  assert.equal(normalizeOkfConceptLifecycleStatus(""), "active");
  assert.equal(normalizeOkfConceptLifecycleStatus(null), "active");
  assert.equal(normalizeOkfConceptLifecycleStatus(undefined), "active");
});

test("softDeleteDocument soft-deletes the document, deactivates only raw-extraction RAG chunks, and leaves OKF bundle files untouched", async () => {
  const deletedAt = new Date("2026-07-07T18:00:00.000Z");
  const calls: unknown[] = [];
  const client = {
    activityEvent: {
      async create(input: unknown) {
        calls.push(["activityEvent.create", input]);
      },
    },
    document: {
      async update(input: unknown) {
        calls.push(["document.update", input]);
        return { title: "737NG AMM 29 Air Ground" };
      },
    },
    okfConceptLifecycle: {
      async upsert() {
        assert.fail("soft-deleting a document must not touch OKF lifecycle records");
      },
    },
    ragChunk: {
      async updateMany(input: unknown) {
        calls.push(["ragChunk.updateMany", input]);
      },
    },
  };

  await softDeleteDocument({
    actorId: "user_1",
    client,
    deletedAt,
    documentId: "doc_1",
    reason: "Duplicate upload",
    workspaceId: "wrk_1",
  });

  assert.deepEqual(calls, [
    [
      "document.update",
      {
        data: {
          deleteReason: "Duplicate upload",
          deletedAt,
          deletedBy: "user_1",
        },
        select: { title: true },
        where: { id: "doc_1", workspaceId: "wrk_1" },
      },
    ],
    [
      "ragChunk.updateMany",
      {
        data: { isActive: false },
        where: {
          documentId: "doc_1",
          sourceType: "raw_extraction",
          workspaceId: "wrk_1",
        },
      },
    ],
    [
      "activityEvent.create",
      {
        data: {
          documentId: "doc_1",
          documentTitle: "737NG AMM 29 Air Ground",
          label: "Document soft-deleted: Duplicate upload",
          status: "blocked",
          timestamp: "Just now",
          workspaceId: "wrk_1",
        },
      },
    ],
  ]);
});

test("softDeleteDocument requires a reason", async () => {
  const client = {
    document: {
      async update() {
        assert.fail("document.update should not run without a reason");
      },
    },
  };

  await assert.rejects(
    () =>
      softDeleteDocument({
        actorId: "user_1",
        client,
        documentId: "doc_1",
        reason: " ",
        workspaceId: "wrk_1",
      }),
    /document_delete_reason_required/,
  );
});

test("getOkfConceptLifecycleForFile returns projected lifecycle state", async () => {
  const client = {
    okfConceptLifecycle: {
      async findUnique(input: unknown) {
        assert.deepEqual(input, {
          where: {
            workspaceId_filePath: {
              filePath: "29-air-ground-position-95ac0bd3c2.md",
              workspaceId: "wrk_1",
            },
          },
        });

        return {
          reason: "No longer valid",
          status: "retracted",
        };
      },
    },
  };

  assert.deepEqual(
    await getOkfConceptLifecycleForFile({
      client,
      filePath: "29-air-ground-position-95ac0bd3c2.md",
      workspaceId: "wrk_1",
    }),
    {
      reason: "No longer valid",
      status: "retracted",
    },
  );
});

test("getOkfConceptLifecycleByFile returns active defaults and projected non-active states", async () => {
  const client = {
    okfConceptLifecycle: {
      async findMany(input: unknown) {
        assert.deepEqual(input, {
          where: {
            filePath: { in: ["29-air-ground-position-95ac0bd3c2.md", "32-brakes.md"] },
            workspaceId: "wrk_1",
          },
        });

        return [
          {
            filePath: "29-air-ground-position-95ac0bd3c2.md",
            reason: "No longer valid",
            status: "retracted",
          },
        ];
      },
    },
  };

  assert.deepEqual(
    await getOkfConceptLifecycleByFile({
      client,
      filePaths: ["29-air-ground-position-95ac0bd3c2.md", "32-brakes.md"],
      workspaceId: "wrk_1",
    }),
    new Map([
      [
        "29-air-ground-position-95ac0bd3c2.md",
        {
          reason: "No longer valid",
          status: "retracted",
        },
      ],
      ["32-brakes.md", { status: "active" }],
    ]),
  );
});

test("markOkfConceptLifecycle requires a reason and appends a lifecycle log entry", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-lifecycle-log-"));
  const changedAt = new Date("2026-07-06T18:30:00.000Z");
  const calls: unknown[] = [];
  const client = {
    okfConceptLifecycle: {
      async upsert(input: unknown) {
        calls.push(input);
      },
    },
  };

  try {
    await assert.rejects(
      () =>
        markOkfConceptLifecycle({
          actorId: "user_1",
          changedAt,
          client,
          filePath: "32-brakes.md",
          knowledgeRoot: root,
          reason: " ",
          status: "retracted",
          topicId: "topic_1",
          workspaceId: "wrk_1",
        }),
      /okf_lifecycle_reason_required/,
    );

    await markOkfConceptLifecycle({
      actorId: "user_1",
      changedAt,
      client,
      filePath: "32-brakes.md",
      knowledgeRoot: root,
      reason: "Incorrect source mapping",
      status: "retracted",
      topicId: "topic_1",
      workspaceId: "wrk_1",
    });

    assert.deepEqual(calls, [
      {
        create: {
          changedAt,
          changedBy: "user_1",
          filePath: "32-brakes.md",
          reason: "Incorrect source mapping",
          status: "retracted",
          topicId: "topic_1",
          workspaceId: "wrk_1",
        },
        update: {
          changedAt,
          changedBy: "user_1",
          reason: "Incorrect source mapping",
          status: "retracted",
          topicId: "topic_1",
        },
        where: {
          workspaceId_filePath: {
            filePath: "32-brakes.md",
            workspaceId: "wrk_1",
          },
        },
      },
    ]);

    const log = await readFile(path.join(root, "log.md"), "utf8");
    assert.match(
      log,
      /- 2026-07-06 - retracted - 32-brakes\.md - Incorrect source mapping/,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("markOkfConceptLifecycle accepts the deleted status", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-lifecycle-deleted-"));
  const changedAt = new Date("2026-07-07T12:00:00.000Z");
  const calls: unknown[] = [];
  const client = {
    okfConceptLifecycle: {
      async upsert(input: unknown) {
        calls.push(input);
      },
    },
  };

  try {
    await markOkfConceptLifecycle({
      actorId: "user_1",
      changedAt,
      client,
      filePath: "32-brakes.md",
      knowledgeRoot: root,
      reason: "Superseded by revision 2026-07",
      status: "deleted",
      topicId: "topic_1",
      workspaceId: "wrk_1",
    });

    assert.equal(
      (calls[0] as { create: { status: string } }).create.status,
      "deleted",
    );

    const log = await readFile(path.join(root, "log.md"), "utf8");
    assert.match(
      log,
      /- 2026-07-07 - deleted - 32-brakes\.md - Superseded by revision 2026-07/,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

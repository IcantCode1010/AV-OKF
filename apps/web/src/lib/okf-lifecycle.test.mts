import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertDocumentCanBeSoftDeleted,
  buildOkfLifecycleFilename,
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

test("assertDocumentCanBeSoftDeleted blocks documents with approved topics", async () => {
  const client = {
    topicRecord: {
      async count(input: unknown) {
        assert.deepEqual(input, {
          where: {
            documentId: "doc_1",
            reviewStatus: "approved",
            workspaceId: "wrk_1",
          },
        });
        return 1;
      },
    },
  };

  await assert.rejects(
    () =>
      assertDocumentCanBeSoftDeleted({
        client,
        documentId: "doc_1",
        workspaceId: "wrk_1",
      }),
    /document_delete_blocked_by_approved_okf/,
  );
});

test("softDeleteDocument marks a document deleted only after dependency guard passes", async () => {
  const calls: unknown[] = [];
  const deletedAt = new Date("2026-07-06T18:00:00.000Z");
  const client = {
    document: {
      async update(input: unknown) {
        calls.push(["document.update", input]);
      },
    },
    ragChunk: {
      async updateMany(input: unknown) {
        calls.push(["ragChunk.updateMany", input]);
      },
    },
    topicRecord: {
      async count() {
        return 0;
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
          deletedAt,
          deletedBy: "user_1",
          deleteReason: "Duplicate upload",
          status: "deleted",
        },
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
  ]);
});

test("softDeleteDocument requires a reason", async () => {
  const client = {
    document: {
      async update() {
        assert.fail("document.update should not run without a reason");
      },
    },
    ragChunk: {
      async updateMany() {
        assert.fail("ragChunk.updateMany should not run without a reason");
      },
    },
    topicRecord: {
      async count() {
        return 0;
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

test("buildOkfLifecycleFilename derives the exported concept filename", () => {
  const filename = buildOkfLifecycleFilename({
    document: {
      aircraftFamily: "Boeing 737NG",
      ata: "32",
      effectivity: "737-700/800/900",
      manualType: "AMM",
      revision: "2026-06",
      sourceAuthority: "Boeing Aircraft Maintenance Manual",
      title: "737NG AMM 32 Landing Gear",
    },
    knowledgeVersion: "0.1.0",
    topic: {
      id: "topic_lifecycle_filename",
      pageEnd: 4,
      pageStart: 3,
      reviewStatus: "approved",
      sourcePageNumbers: [3, 4],
      summary: "Brake system operation and inspection requirements.",
      title: "Main Gear Brake System",
    },
  });

  assert.match(filename, /^32-main-gear-brake-system-[a-f0-9]{10}\.md$/);
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

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildOkfLifecycleFilename,
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

test("softDeleteDocument removes all derived bundle products and hard-deletes the document", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-soft-delete-"));
  const calls: unknown[] = [];
  const deletedAt = new Date("2026-07-06T18:00:00.000Z");
  let exportedFilename = "";
  let rejectedExportedFilename = "";
  const client = {
    document: {
      async findUnique(input: unknown) {
        calls.push(["document.findUnique", input]);
        return {
          aircraftFamily: "Boeing 737NG",
          ata: "29",
          effectivity: "737-700/800/900",
          manualType: "AMM",
          revision: "2026-06",
          sourceAuthority: "Boeing Aircraft Maintenance Manual",
          title: "737NG AMM 29 Air Ground",
        };
      },
      async delete(input: unknown) {
        calls.push(["document.delete", input]);
      },
    },
    okfConceptLifecycle: {
      async upsert() {
        assert.fail("source document hard-delete must not create lifecycle retractions");
      },
    },
    topicRecord: {
      async findMany(input: unknown) {
        calls.push(["topicRecord.findMany", input]);
        return [
          {
            id: "topic_air_ground",
            pageEnd: 4,
            pageStart: 3,
            reviewStatus: "approved",
            sourcePageNumbers: [3, 4],
            summary: "Air ground position summary.",
            title: "AIR/GROUND - POSITION",
          },
          {
            id: "topic_air_ground_system",
            pageEnd: 7,
            pageStart: 5,
            reviewStatus: "rejected",
            sourcePageNumbers: [5, 6, 7],
            summary: "Air ground system summary.",
            title: "AIR/GROUND SYSTEM",
          },
        ];
      },
    },
  };

  try {
    exportedFilename = buildOkfLifecycleFilename({
      document: {
        aircraftFamily: "Boeing 737NG",
        ata: "29",
        effectivity: "737-700/800/900",
        manualType: "AMM",
        revision: "2026-06",
        sourceAuthority: "Boeing Aircraft Maintenance Manual",
        title: "737NG AMM 29 Air Ground",
      },
      knowledgeVersion: process.env.AV_OKF_KNOWLEDGE_VERSION || "0.1.0",
      topic: {
        id: "topic_air_ground",
        pageEnd: 4,
        pageStart: 3,
        reviewStatus: "approved",
        sourcePageNumbers: [3, 4],
        summary: "Air ground position summary.",
        title: "AIR/GROUND - POSITION",
      },
    });
    rejectedExportedFilename = buildOkfLifecycleFilename({
      document: {
        aircraftFamily: "Boeing 737NG",
        ata: "29",
        effectivity: "737-700/800/900",
        manualType: "AMM",
        revision: "2026-06",
        sourceAuthority: "Boeing Aircraft Maintenance Manual",
        title: "737NG AMM 29 Air Ground",
      },
      knowledgeVersion: process.env.AV_OKF_KNOWLEDGE_VERSION || "0.1.0",
      topic: {
        id: "topic_air_ground_system",
        pageEnd: 7,
        pageStart: 5,
        reviewStatus: "rejected",
        sourcePageNumbers: [5, 6, 7],
        summary: "Air ground system summary.",
        title: "AIR/GROUND SYSTEM",
      },
    });
    await writeFile(
      path.join(root, exportedFilename),
      "---\ntype: system_topic\nreview_status: approved\n---\n",
      "utf8",
    );
    await writeFile(
      path.join(root, rejectedExportedFilename),
      "---\ntype: system_topic\nreview_status: approved\n---\n",
      "utf8",
    );
    await writeFile(
      path.join(root, "index.md"),
      `# AV-OKF Knowledge Bundle\n- [AIR/GROUND - POSITION](${exportedFilename}) - Air ground position summary.\n- [AIR/GROUND SYSTEM](${rejectedExportedFilename}) - Air ground system summary.\n\nBundle notes.\n`,
      "utf8",
    );
    await writeFile(
      path.join(root, "source_manifest.md"),
      [
        "---",
        'type: "source_manifest"',
        "---",
        "",
        "# Source Manifest",
        "- 737NG AMM 29 Air Ground",
        "  - aircraft_family: Boeing 737NG",
        "  - source_authority: Boeing Aircraft Maintenance Manual",
        "  - manual_type: AMM",
        "  - ata: 29",
        "  - effectivity: 737-700/800/900",
        "  - revision: 2026-06",
        "",
      ].join("\n"),
      "utf8",
    );

    await softDeleteDocument({
      actorId: "user_1",
      client,
      deletedAt,
      documentId: "doc_1",
      knowledgeRoot: root,
      reason: "Duplicate upload",
      workspaceId: "wrk_1",
    });

    await assert.rejects(
      () => readFile(path.join(root, exportedFilename), "utf8"),
      (error) =>
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT",
    );
    await assert.rejects(
      () => readFile(path.join(root, rejectedExportedFilename), "utf8"),
      (error) =>
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT",
    );
    const index = await readFile(path.join(root, "index.md"), "utf8");
    assert.doesNotMatch(index, new RegExp(exportedFilename));
    assert.doesNotMatch(index, new RegExp(rejectedExportedFilename));
    const manifest = await readFile(path.join(root, "source_manifest.md"), "utf8");
    assert.doesNotMatch(manifest, /737NG AMM 29 Air Ground/);
    const log = await readFile(path.join(root, "log.md"), "utf8");
    assert.match(
      log,
      /- 2026-07-06 - delete-document - source: 737NG AMM 29 Air Ground - actor: user_1 - concepts_removed: 2 - reason: Duplicate upload/,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }

  assert.deepEqual(calls[0], [
    "topicRecord.findMany",
    {
      where: {
        documentId: "doc_1",
        workspaceId: "wrk_1",
      },
    },
  ]);
  assert.deepEqual(calls[1], [
    "document.findUnique",
    {
      select: {
        aircraftFamily: true,
        ata: true,
        effectivity: true,
        manualType: true,
        revision: true,
        sourceAuthority: true,
        title: true,
      },
      where: { id: "doc_1", workspaceId: "wrk_1" },
    },
  ]);
  assert.deepEqual(calls.slice(2), [
    [
      "document.delete",
      {
        where: { id: "doc_1", workspaceId: "wrk_1" },
      },
    ],
  ]);
});

test("softDeleteDocument requires a reason", async () => {
  const client = {
    document: {
      async delete() {
        assert.fail("document.delete should not run without a reason");
      },
    },
    topicRecord: {
      async findMany() {
        assert.fail("topicRecord.findMany should not run without a reason");
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

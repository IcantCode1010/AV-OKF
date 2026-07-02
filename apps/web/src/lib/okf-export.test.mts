import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildOkfSystemTopic,
  exportTopicToKnowledge,
} from "./okf-export.ts";

const approvedTopic = {
  id: "topic_32_brakes",
  title: "Main Gear Brake System",
  summary:
    "The main gear brake system provides normal and alternate braking for the main landing gear wheels.",
  pageStart: 41,
  pageEnd: 43,
  reviewStatus: "approved",
  sourcePageNumbers: [41, 42, 43],
};

const exportDocument = {
  title: "737NG AMM 32 Landing Gear",
  aircraftFamily: "Boeing 737NG",
  manualType: "AMM",
  ata: "32",
  effectivity: "737-700/800/900",
  sourceAuthority: "Boeing Aircraft Maintenance Manual",
  revision: "2026-06",
};

test("buildOkfSystemTopic emits every required system_topic frontmatter field", async () => {
  const requiredFields = await readRequiredSystemTopicFields();
  const exported = buildOkfSystemTopic({
    document: exportDocument,
    exportedAt: new Date("2026-07-02T12:00:00.000Z"),
    knowledgeVersion: "0.1.0",
    topic: approvedTopic,
  });
  const frontmatter = parseFrontmatter(exported.content);

  for (const field of requiredFields) {
    assert.equal(
      Object.hasOwn(frontmatter, field),
      true,
      `missing required frontmatter field: ${field}`,
    );
  }
});

test("buildOkfSystemTopic rejects non-approved topics", () => {
  assert.throws(
    () =>
      buildOkfSystemTopic({
        document: exportDocument,
        knowledgeVersion: "0.1.0",
        topic: { ...approvedTopic, reviewStatus: "needs_review" },
      }),
    /okf_export_requires_approved_topic/,
  );
});

test("buildOkfSystemTopic reports missing document metadata fields", () => {
  assert.throws(
    () =>
      buildOkfSystemTopic({
        document: {
          ...exportDocument,
          aircraftFamily: null,
          effectivity: null,
          sourceAuthority: null,
        },
        knowledgeVersion: "0.1.0",
        topic: approvedTopic,
      }),
    /okf_export_missing_document_metadata: aircraftFamily, effectivity, sourceAuthority/,
  );
});

test("buildOkfSystemTopic creates deterministic safe ATA-prefixed filenames", () => {
  const exported = buildOkfSystemTopic({
    document: { ...exportDocument, ata: "32-41" },
    knowledgeVersion: "0.1.0",
    topic: { ...approvedTopic, title: "Main Gear / Brake System?" },
  });

  assert.equal(exported.filename, "32-41-main-gear-brake-system-topic_32.md");
  assert.equal(exported.filename.includes(" "), false);
  assert.equal(/[\\/]/.test(exported.filename), false);
});

test("buildOkfSystemTopic rejects titles that produce empty slugs", () => {
  assert.throws(
    () =>
      buildOkfSystemTopic({
        document: exportDocument,
        knowledgeVersion: "0.1.0",
        topic: { ...approvedTopic, title: "!!!" },
      }),
    /okf_export_invalid_title: title produces empty slug/,
  );
});

test("buildOkfSystemTopic caps long title slugs without trailing hyphen", () => {
  const exported = buildOkfSystemTopic({
    document: exportDocument,
    knowledgeVersion: "0.1.0",
    topic: {
      ...approvedTopic,
      id: "topic_long_title",
      title: Array.from({ length: 60 }, (_, index) => `Brake ${index}`).join(" "),
    },
  });
  const withoutExtension = exported.filename.replace(/\.md$/, "");
  const idFragment = "topic_lo";
  const slug = withoutExtension
    .replace(/^32-/, "")
    .replace(new RegExp(`-${idFragment}$`), "");

  assert.equal(exported.filename.length <= 100, true);
  assert.equal(slug.endsWith("-"), false);
});

test("buildOkfSystemTopic avoids collisions for matching titles and ATA", () => {
  const first = buildOkfSystemTopic({
    document: exportDocument,
    knowledgeVersion: "0.1.0",
    topic: { ...approvedTopic, id: "topic_a_1234" },
  });
  const second = buildOkfSystemTopic({
    document: exportDocument,
    knowledgeVersion: "0.1.0",
    topic: { ...approvedTopic, id: "topic_b_5678" },
  });

  assert.notEqual(first.filename, second.filename);
});

test("buildOkfSystemTopic requires a topic id for collision-safe filenames", () => {
  const topicWithoutId = { ...approvedTopic };
  delete (topicWithoutId as Partial<typeof approvedTopic>).id;

  assert.throws(
    () =>
      buildOkfSystemTopic({
        document: exportDocument,
        knowledgeVersion: "0.1.0",
        topic: topicWithoutId,
      }),
    /okf_export_requires_topic_id/,
  );
});

test("exportTopicToKnowledge updates index idempotently", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-export-"));

  try {
    await exportTopicToKnowledge({
      document: exportDocument,
      exportedAt: new Date("2026-07-02T12:00:00.000Z"),
      knowledgeRoot: root,
      knowledgeVersion: "0.1.0",
      topic: approvedTopic,
    });
    await exportTopicToKnowledge({
      document: exportDocument,
      exportedAt: new Date("2026-07-02T12:00:00.000Z"),
      knowledgeRoot: root,
      knowledgeVersion: "0.1.0",
      topic: approvedTopic,
    });

    const index = await readFile(path.join(root, "index.md"), "utf8");
    const entryCount = index
      .split("\n")
      .filter((line) =>
        line.includes("(32-main-gear-brake-system-topic_32.md)"),
      ).length;

    assert.equal(entryCount, 1);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("exportTopicToKnowledge keeps matching-title topics as separate index entries", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-export-collision-"));

  try {
    await exportTopicToKnowledge({
      document: exportDocument,
      exportedAt: new Date("2026-07-02T12:00:00.000Z"),
      knowledgeRoot: root,
      knowledgeVersion: "0.1.0",
      topic: { ...approvedTopic, id: "topic_a_1234" },
    });
    await exportTopicToKnowledge({
      document: exportDocument,
      exportedAt: new Date("2026-07-02T12:00:00.000Z"),
      knowledgeRoot: root,
      knowledgeVersion: "0.1.0",
      topic: { ...approvedTopic, id: "topic_b_5678" },
    });

    const index = await readFile(path.join(root, "index.md"), "utf8");

    assert.equal(index.includes("(32-main-gear-brake-system-topic_a_.md)"), true);
    assert.equal(index.includes("(32-main-gear-brake-system-topic_b_.md)"), true);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("buildOkfSystemTopic frontmatter always marks review_status approved", () => {
  const exported = buildOkfSystemTopic({
    document: exportDocument,
    exportedAt: new Date("2026-07-02T12:00:00.000Z"),
    knowledgeVersion: "0.1.0",
    topic: approvedTopic,
  });
  const frontmatter = parseFrontmatter(exported.content);

  assert.equal(frontmatter.review_status, "approved");
});

async function readRequiredSystemTopicFields() {
  const manifest = await readFile(
    path.join(process.cwd(), "..", "..", "okf-base.yaml"),
    "utf8",
  );
  const lines = manifest.split(/\r?\n/);
  const systemTopicIndex = lines.findIndex((line) => line.trim() === "system_topic:");
  const requiredIndex = lines.findIndex(
    (line, index) => index > systemTopicIndex && line.trim() === "required:",
  );
  const fields: string[] = [];

  for (const line of lines.slice(requiredIndex + 1)) {
    if (!line.startsWith("      - ")) {
      break;
    }

    fields.push(line.trim().slice(2).trim());
  }

  assert.notEqual(systemTopicIndex, -1);
  assert.notEqual(requiredIndex, -1);
  assert.equal(fields.length > 0, true);

  return fields;
}

function parseFrontmatter(markdown: string) {
  const match = /^---\n([\s\S]*?)\n---/.exec(markdown);
  assert.ok(match, "expected YAML frontmatter");
  const result: Record<string, unknown> = {};
  const lines = match[1]!.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const scalar = /^([a-z_]+):\s*(.*)$/.exec(line);

    if (scalar && scalar[2] !== "") {
      result[scalar[1]!] = scalar[2]!.replace(/^"|"$/g, "");
      continue;
    }

    if (scalar) {
      const values: string[] = [];
      for (let listIndex = index + 1; listIndex < lines.length; listIndex += 1) {
        const item = /^  -\s*(.*)$/.exec(lines[listIndex]!);
        if (!item) {
          break;
        }

        values.push(item[1]!.replace(/^"|"$/g, ""));
        index = listIndex;
      }
      result[scalar[1]!] = values;
    }
  }

  return result;
}

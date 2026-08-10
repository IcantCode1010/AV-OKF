import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildOkfSourceReference,
  buildOkfSystemTopic,
  exportTopicToKnowledge,
} from "./okf-export.ts";
import {
  getFrontmatterSources,
  getFrontmatterVerificationEvents,
  parseOkfMarkdown,
} from "./okf-frontmatter.ts";

const approvedTopic = {
  id: "topic_32_brakes",
  title: "Main Gear Brake System",
  summary: "The main gear brake system provides normal and alternate braking.",
  pageStart: 41,
  pageEnd: 43,
  reviewStatus: "approved",
  sourcePageNumbers: [41, 42, 43],
};

const exportDocument = {
  classificationCode: "32",
  contentSha256: "a".repeat(64),
  documentType: "AMM",
  effectivity: "737-700/800/900",
  mimeType: "application/pdf",
  originalFilename: "737ng-amm-32.pdf",
  revision: "2026-06",
  sizeBytes: 123456,
  sourceAuthority: "Boeing Aircraft Maintenance Manual",
  subjectFamily: "Boeing 737NG",
  title: "737NG AMM 32 Landing Gear",
};

test("buildOkfSystemTopic emits the v0.2 trust and provenance contract", () => {
  const parsed = parseOkfMarkdown(buildOkfSystemTopic({
    document: exportDocument,
    exportedAt: new Date("2026-07-02T12:00:00.000Z"),
    knowledgeVersion: "0.2.0",
    topic: {
      ...approvedTopic,
      approvalMode: "human_individual",
      approvedAt: "2026-07-02T11:00:00.000Z",
      approvedBy: "reviewer-1",
    },
  }).content);

  assert.equal(parsed.frontmatter.type, "system_topic");
  assert.equal(parsed.frontmatter.status, "stable");
  assert.deepEqual(getFrontmatterVerificationEvents(parsed.frontmatter), [{
    at: "2026-07-02T11:00:00.000Z",
    by: "human:reviewer-1",
  }]);
  assert.deepEqual(getFrontmatterSources(parsed.frontmatter), [{
    id: `source-${"a".repeat(12)}`,
    resource: "/references/sources/source-document-aaaaaaaaaaaa.md",
    title: exportDocument.title,
  }]);
  assert.deepEqual(parsed.frontmatter.source_pages, [41, 42, 43]);
  for (const removed of ["review_status", "approved_by", "approved_at", "updated", "source_file"]) {
    assert.equal(Object.hasOwn(parsed.frontmatter, removed), false, `${removed} must not be emitted`);
  }
});

test("buildOkfSystemTopic rejects non-approved topics", () => {
  assert.throws(() => buildOkfSystemTopic({
    document: exportDocument,
    knowledgeVersion: "0.2.0",
    topic: { ...approvedTopic, reviewStatus: "needs_review" },
  }), /okf_export_requires_approved_topic/);
});

test("approval modes map to distinct verification actors", () => {
  const automated = parseOkfMarkdown(buildOkfSystemTopic({
    document: exportDocument,
    exportedAt: new Date("2026-07-20T12:00:00.000Z"),
    knowledgeVersion: "0.2.0",
    topic: { ...approvedTopic, approvalMode: "automated", approvedBy: "user-1" },
  }).content).frontmatter;
  const legacy = parseOkfMarkdown(buildOkfSystemTopic({
    document: exportDocument,
    exportedAt: new Date("2026-07-20T12:00:00.000Z"),
    knowledgeVersion: "0.2.0",
    topic: { ...approvedTopic, approvalMode: null, approvedBy: null },
  }).content).frontmatter;
  assert.equal(getFrontmatterVerificationEvents(automated)[0]?.by, "process:av-okf-auto-approval");
  assert.equal(automated.av_okf_approval_mode, "automated");
  assert.equal(getFrontmatterVerificationEvents(legacy)[0]?.by, "process:av-okf-v0.1-migration");
  assert.equal(legacy.av_okf_approval_mode, "legacy");
});

test("source reference identity is deterministic and content-addressed", () => {
  const first = buildOkfSourceReference({
    document: exportDocument,
    exportedAt: new Date("2026-07-20T12:00:00.000Z"),
    knowledgeVersion: "0.2.0",
  });
  const second = buildOkfSourceReference({
    document: {
      ...exportDocument,
      originalFilename: "renamed-copy.pdf",
      title: "Renamed copy of the same PDF",
    },
    exportedAt: new Date("2026-07-20T12:00:00.000Z"),
    knowledgeVersion: "0.2.0",
  });
  assert.equal(first.filename, second.filename);
  assert.equal(first.filename, "references/sources/source-document-aaaaaaaaaaaa.md");
  const parsed = parseOkfMarkdown(first.content);
  assert.equal(parsed.frontmatter.resource, `urn:sha256:${"a".repeat(64)}`);
  assert.equal(parsed.frontmatter.av_okf_role, "source_document");
  assert.equal(parsed.frontmatter.verified, undefined);
});

test("source reference export requires a valid document digest", () => {
  assert.throws(() => buildOkfSourceReference({
    document: { ...exportDocument, contentSha256: null },
    knowledgeVersion: "0.2.0",
  }), /okf_export_requires_source_hash/);
});

test("topic filenames are deterministic and collision-safe", () => {
  const first = buildOkfSystemTopic({
    document: exportDocument,
    knowledgeVersion: "0.2.0",
    topic: approvedTopic,
  });
  const second = buildOkfSystemTopic({
    document: exportDocument,
    knowledgeVersion: "0.2.0",
    topic: { ...approvedTopic, id: "topic_other" },
  });
  assert.match(first.filename, /^32-main-gear-brake-system-[a-f0-9]{10}\.md$/);
  assert.notEqual(first.filename, second.filename);
});

test("typed relations are emitted in frontmatter and as Markdown links", () => {
  const parsed = parseOkfMarkdown(buildOkfSystemTopic({
    document: exportDocument,
    knowledgeVersion: "0.2.0",
    topic: {
      ...approvedTopic,
      relations: [{
        relation: "references",
        reason: "Provides the dispatch context.",
        target: "dispatch.md",
        targetType: "procedure",
      }],
    },
  }).content);
  assert.equal(Array.isArray(parsed.frontmatter.relations), true);
  assert.match(parsed.body, /\[references\]\(dispatch\.md\)/);
});

test("export writes topic, source reference, v0.2 index, and date-grouped log idempotently", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-v02-export-"));
  try {
    const input = {
      directory: "concepts/system-topic",
      document: exportDocument,
      exportedAt: new Date("2026-07-20T12:00:00.000Z"),
      knowledgeRoot: root,
      knowledgeVersion: "0.2.0",
      topic: approvedTopic,
    };
    const first = await exportTopicToKnowledge(input);
    await exportTopicToKnowledge(input);
    const index = await readFile(path.join(root, "index.md"), "utf8");
    const log = await readFile(path.join(root, "log.md"), "utf8");
    const source = buildOkfSourceReference(input);
    assert.equal((index.match(new RegExp(escapeRegex(first.filename), "g")) ?? []).length, 1);
    assert.equal(parseOkfMarkdown(index).frontmatter.okf_version, "0.2");
    assert.match(log, /## 2026-07-20/);
    assert.match(log, /Creation/);
    assert.match(log, /Update/);
    assert.equal((await readFile(path.join(root, source.filename), "utf8")).length > 0, true);
    await assert.rejects(readFile(path.join(root, "source_manifest.md"), "utf8"));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("export validates relation targets before writing", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-v02-relation-"));
  try {
    await assert.rejects(exportTopicToKnowledge({
      document: exportDocument,
      knowledgeRoot: root,
      knowledgeVersion: "0.2.0",
      topic: {
        ...approvedTopic,
        relations: [{ relation: "references", reason: "Missing", target: "missing.md" }],
      },
    }), /relation_target_missing/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("export preserves clean article framing", () => {
  const exported = buildOkfSystemTopic({
    document: exportDocument,
    knowledgeVersion: "0.2.0",
    topic: {
      ...approvedTopic,
      approvedContentSource: "enriched",
      enrichedBody: "# Main Gear Brake System\n\n## Procedure\nApply the brakes.\n\n## Source\nStale source.",
    },
  });
  assert.equal((exported.content.match(/^# Main Gear Brake System$/gm) ?? []).length, 1);
  assert.equal((exported.content.match(/^## Source$/gm) ?? []).length, 1);
  assert.doesNotMatch(exported.content, /Stale source/);
});

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { exportApprovedTopicForDocument } from "./okf-export-service.ts";
import type { Document, TopicRecord } from "./document-vault.ts";

const document: Document = {
  id: "doc-amm-32",
  title: "737NG AMM 32 Landing Gear",
  fileType: "PDF",
  size: "1 MB",
  sizeBytes: 1_000_000,
  status: "ready",
  tags: ["737NG", "AMM", "ATA 32"],
  updatedAt: "Seeded",
  owner: "Maintenance Control",
  sourceType: "aviation",
  pages: 80,
  description: "Landing gear manual section.",
  storageKey: "opaque.pdf",
  originalFilename: "amm-32.pdf",
  mimeType: "application/pdf",
  customProperties: [],
  aircraftFamily: "Boeing 737NG",
  manualType: "AMM",
  ata: "32",
  effectivity: "737-700/800/900",
  sourceAuthority: "Boeing Aircraft Maintenance Manual",
  revision: "2026-06",
  extraction: {
    status: "completed",
    startedAt: null,
    completedAt: null,
    error: null,
    pageRecords: [],
    logs: [],
  },
};

const approvedTopic: TopicRecord = {
  id: "topic_32_brakes",
  documentId: document.id,
  title: "Main Gear Brake System",
  topicType: "system_topic",
  summary:
    "The main gear brake system provides normal and alternate braking for the main landing gear wheels.",
  pageStart: 41,
  pageEnd: 43,
  confidence: "high",
  reviewStatus: "approved",
  sourcePageNumbers: [41, 42, 43],
  createdAt: "Seeded",
  updatedAt: "Seeded",
};

test("exportApprovedTopicForDocument writes an approved topic from document and topic records", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-service-export-"));

  try {
    const exported = await exportApprovedTopicForDocument({
      document,
      exportedAt: new Date("2026-07-02T12:00:00.000Z"),
      knowledgeRoot: root,
      knowledgeVersion: "0.1.0",
      topicId: approvedTopic.id,
      topics: [approvedTopic],
    });

    assert.equal(exported.filename, "32-main-gear-brake-system-494f144a6e.md");
    const markdown = await readFile(path.join(root, exported.filename), "utf8");
    assert.match(markdown, /type: "system_topic"/);
    assert.match(markdown, /review_status: "approved"/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("exportApprovedTopicForDocument rejects unknown topic ids", async () => {
  await assert.rejects(
    () =>
      exportApprovedTopicForDocument({
        document,
        knowledgeVersion: "0.1.0",
        topicId: "topic_missing",
        topics: [approvedTopic],
      }),
    /topic_not_found/,
  );
});

test("exportApprovedTopicForDocument keeps non-approved topics blocked", async () => {
  await assert.rejects(
    () =>
      exportApprovedTopicForDocument({
        document,
        knowledgeVersion: "0.1.0",
        topicId: approvedTopic.id,
        topics: [{ ...approvedTopic, reviewStatus: "needs_review" }],
      }),
    /okf_export_requires_approved_topic/,
  );
});

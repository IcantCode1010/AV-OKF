import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createLocalDocumentVault } from "./document-vault.ts";
import { generateTopicCandidates } from "./topic-records.ts";

test("generateTopicCandidates creates heading-based topics with categorical confidence", () => {
  const topics = generateTopicCandidates("doc-1", [
    {
      pageNumber: 1,
      text: "ATA 24 ELECTRICAL POWER\nGenerator bus procedure details.",
      tables: [],
      imageCount: 0,
      charCount: 55,
    },
    {
      pageNumber: 2,
      text: "More generator bus procedure details.",
      tables: [],
      imageCount: 0,
      charCount: 37,
    },
    {
      pageNumber: 3,
      text: "SECTION 2 FAULT ISOLATION\nFault isolation details.",
      tables: [],
      imageCount: 0,
      charCount: 49,
    },
  ]);

  assert.equal(topics.length, 2);
  assert.equal(topics[0]?.title, "ATA 24 ELECTRICAL POWER");
  assert.equal(topics[0]?.confidence, "high");
  assert.deepEqual(topics[0]?.sourcePageNumbers, [1, 2]);
  assert.equal(topics[1]?.title, "SECTION 2 FAULT ISOLATION");
  assert.equal(topics[1]?.confidence, "high");
  assert.deepEqual(topics[1]?.sourcePageNumbers, [3]);
});

test("generateTopicCandidates falls back to coarse page ranges with low confidence", () => {
  const topics = generateTopicCandidates("doc-1", [
    {
      pageNumber: 1,
      text: "This page has body text only.",
      tables: [],
      imageCount: 0,
      charCount: 29,
    },
    {
      pageNumber: 2,
      text: "This page also has body text only.",
      tables: [],
      imageCount: 0,
      charCount: 34,
    },
  ]);

  assert.equal(topics.length, 1);
  assert.equal(topics[0]?.title, "Pages 1-2");
  assert.equal(topics[0]?.confidence, "low");
  assert.deepEqual(topics[0]?.sourcePageNumbers, [1, 2]);
});

test("vault topic generation requires completed extraction", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-topics-"));
  const vault = createLocalDocumentVault(root);

  try {
    const uploaded = await vault.createUploadedDocument({
      bytes: Buffer.from("%PDF-1.7\n"),
      description: "Topic generation requires extraction.",
      originalFilename: "manual.pdf",
      owner: "Maintenance Control",
      sourceType: "aviation",
      tags: ["topic"],
      title: "Topic Manual",
      type: "application/pdf",
    });

    await assert.rejects(
      () => vault.generateTopicRecords(uploaded.id),
      /document_extraction_not_completed/,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("vault rerun replaces draft topics but preserves reviewed topic coverage", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-topics-"));
  const vault = createLocalDocumentVault(root);

  try {
    const uploaded = await vault.createUploadedDocument({
      bytes: Buffer.from("%PDF-1.7\n"),
      description: "Topic rerun behavior.",
      originalFilename: "manual.pdf",
      owner: "Maintenance Control",
      sourceType: "aviation",
      tags: ["topic"],
      title: "Topic Manual",
      type: "application/pdf",
    });

    await vault.completeExtraction(uploaded.id, {
      pageRecords: [
        {
          pageNumber: 1,
          text: "ATA 24 ELECTRICAL POWER\nGenerator bus detail.",
          tables: [],
          imageCount: 0,
          charCount: 45,
        },
        {
          pageNumber: 2,
          text: "SECTION 2 FAULT ISOLATION\nFault detail.",
          tables: [],
          imageCount: 0,
          charCount: 39,
        },
      ],
    });

    const firstRun = await vault.generateTopicRecords(uploaded.id);
    assert.equal(firstRun.length, 2);

    await vault.updateTopicReviewStatus(firstRun[0]!.id, "approved");

    const rerun = await vault.generateTopicRecords(uploaded.id);
    assert.equal(rerun.some((topic) => topic.id === firstRun[0]!.id), true);
    assert.equal(
      rerun.some(
        (topic) =>
          topic.id !== firstRun[0]!.id && topic.sourcePageNumbers.includes(1),
      ),
      false,
    );
    assert.equal(
      rerun.some(
        (topic) =>
          topic.id !== firstRun[1]!.id && topic.sourcePageNumbers.includes(2),
      ),
      true,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createLocalDocumentVault } from "./document-vault.ts";
import { runExtractionJob } from "./document-extraction.ts";

test("runExtractionJob stores page records when extraction succeeds", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-extraction-"));
  const vault = createLocalDocumentVault(root);

  try {
    const uploaded = await vault.createUploadedDocument({
      bytes: Buffer.from("%PDF-1.7\nfake"),
      description: "Extraction job test.",
      originalFilename: "manual.pdf",
      owner: "Maintenance Control",
      sourceType: "aviation",
      tags: ["job"],
      title: "Job Manual",
      type: "application/pdf",
    });

    await runExtractionJob(uploaded.id, {
      extractPdfPages: async () => [
        {
          pageNumber: 1,
          text: "Page one text",
          tables: [],
          imageCount: 0,
          charCount: 13,
        },
      ],
      vault,
    });

    const document = await vault.getDocumentById(uploaded.id);
    assert.equal(document?.status, "ready");
    assert.equal(document?.extraction.status, "completed");
    assert.equal(document?.extraction.pageRecords[0]?.text, "Page one text");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("runExtractionJob records defensive failure state when extraction throws", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-extraction-"));
  const vault = createLocalDocumentVault(root);

  try {
    const uploaded = await vault.createUploadedDocument({
      bytes: Buffer.from("%PDF-1.7\nfake"),
      description: "Extraction job failure test.",
      originalFilename: "locked.pdf",
      owner: "Maintenance Control",
      sourceType: "aviation",
      tags: ["locked"],
      title: "Locked Manual",
      type: "application/pdf",
    });

    await runExtractionJob(uploaded.id, {
      extractPdfPages: async () => {
        throw new Error("password_protected_pdf");
      },
      vault,
    });

    const document = await vault.getDocumentById(uploaded.id);
    assert.equal(document?.status, "blocked");
    assert.equal(document?.extraction.status, "failed");
    assert.equal(document?.extraction.error?.code, "password_protected_pdf");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  MAX_UPLOAD_BYTES,
  assertPdfUpload,
  assertSafeStorageKey,
  createLocalDocumentVault,
  generateStorageKey,
} from "./document-vault.ts";

test("generateStorageKey creates an opaque PDF key without the uploaded filename", () => {
  const key = generateStorageKey("../../737NG AMM.pdf");

  assert.match(key, /^[0-9a-f-]{36}\.pdf$/);
  assert.equal(key.includes("737NG"), false);
  assert.equal(key.includes(".."), false);
  assert.equal(key.includes("/"), false);
  assert.equal(key.includes("\\"), false);
});

test("assertSafeStorageKey blocks paths that escape the upload root", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-vault-"));

  try {
    assert.throws(
      () => assertSafeStorageKey("../escape.pdf", root),
      /target_escapes_root/,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("assertPdfUpload rejects non-PDF and oversized uploads", () => {
  assert.doesNotThrow(() =>
    assertPdfUpload({
      name: "manual.pdf",
      size: MAX_UPLOAD_BYTES,
      type: "application/pdf",
    }),
  );

  assert.throws(
    () =>
      assertPdfUpload({
        name: "manual.txt",
        size: 1024,
        type: "text/plain",
      }),
    /only_pdf_uploads_supported/,
  );

  assert.throws(
    () =>
      assertPdfUpload({
        name: "manual.pdf",
        size: MAX_UPLOAD_BYTES + 1,
        type: "application/pdf",
      }),
    /upload_exceeds_25mb_limit/,
  );
});

test("local vault stores PDF bytes under an opaque key and atomic JSON store", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-vault-"));
  const vault = createLocalDocumentVault(root);

  try {
    const uploaded = await vault.createUploadedDocument({
      bytes: Buffer.from("%PDF-1.7\n"),
      description: "Uploaded for Stage 1 test coverage.",
      originalFilename: "../../manual.pdf",
      owner: "Maintenance Control",
      sourceType: "aviation",
      tags: ["737NG", "AMM"],
      title: "737NG AMM",
      type: "application/pdf",
    });

    assert.match(uploaded.storageKey, /^[0-9a-f-]{36}\.pdf$/);
    assert.equal(uploaded.storageKey.includes("manual"), false);
    assert.equal(uploaded.status, "processing");

    const storedBytes = await readFile(
      path.join(root, "uploads", uploaded.storageKey),
      "utf8",
    );
    assert.equal(storedBytes, "%PDF-1.7\n");

    const documents = await vault.getDocuments();
    assert.equal(documents.some((document) => document.id === uploaded.id), true);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("local vault rejects spoofed PDF uploads without PDF magic bytes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-vault-"));
  const vault = createLocalDocumentVault(root);

  try {
    await assert.rejects(
      () =>
        vault.createUploadedDocument({
          bytes: Buffer.from("not actually a pdf"),
          description: "Spoofed upload.",
          originalFilename: "manual.pdf",
          owner: "Maintenance Control",
          sourceType: "aviation",
          tags: ["spoofed"],
          title: "Spoofed PDF",
          type: "application/pdf",
        }),
      /invalid_pdf_magic_bytes/,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

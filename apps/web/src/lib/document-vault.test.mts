import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  MAX_UPLOAD_BYTES,
  assertPdfUpload,
  assertSafeStorageKey,
  createLocalDocumentVault,
  getDefaultDataRoot,
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

test("default data root can be configured for Docker volume mounts", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-env-vault-"));
  const previousDataRoot = process.env.AV_OKF_DATA_ROOT;
  process.env.AV_OKF_DATA_ROOT = root;
  const vault = createLocalDocumentVault();

  try {
    assert.equal(getDefaultDataRoot(), path.resolve(root));

    const uploaded = await vault.createUploadedDocument({
      bytes: Buffer.from("%PDF-1.7\n"),
      description: "Uploaded into configured data root.",
      originalFilename: "manual.pdf",
      owner: "Maintenance Control",
      sourceType: "aviation",
      tags: ["docker"],
      title: "Configured Data Root Manual",
      type: "application/pdf",
    });

    const storedBytes = await readFile(
      path.join(root, "uploads", uploaded.storageKey),
      "utf8",
    );
    assert.equal(storedBytes, "%PDF-1.7\n");
    await readFile(path.join(root, "document-vault.json"), "utf8");
  } finally {
    if (previousDataRoot === undefined) {
      delete process.env.AV_OKF_DATA_ROOT;
    } else {
      process.env.AV_OKF_DATA_ROOT = previousDataRoot;
    }
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

test("local vault records extraction lifecycle and page records", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-vault-"));
  const vault = createLocalDocumentVault(root);

  try {
    const uploaded = await vault.createUploadedDocument({
      bytes: Buffer.from("%PDF-1.7\n"),
      description: "Uploaded for Stage 2 test coverage.",
      originalFilename: "manual.pdf",
      owner: "Maintenance Control",
      sourceType: "aviation",
      tags: ["737NG"],
      title: "Extractable Manual",
      type: "application/pdf",
    });

    await vault.startExtraction(uploaded.id);
    const running = await vault.getDocumentById(uploaded.id);
    assert.equal(running?.status, "processing");
    assert.equal(running?.extraction.status, "running");
    assert.match(running?.extraction.logs.at(-1)?.message ?? "", /started/i);

    await vault.completeExtraction(uploaded.id, {
      pageRecords: [
        {
          pageNumber: 1,
          text: "Generator bus procedure",
          tables: [],
          imageCount: 0,
          charCount: 23,
        },
      ],
    });

    const completed = await vault.getDocumentById(uploaded.id);
    assert.equal(completed?.status, "ready");
    assert.equal(completed?.pages, 1);
    assert.equal(completed?.extraction.status, "completed");
    assert.equal(completed?.extraction.pageRecords[0]?.pageNumber, 1);
    assert.equal(completed?.extraction.pageRecords[0]?.text, "Generator bus procedure");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("local vault records extraction failures without losing document metadata", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-vault-"));
  const vault = createLocalDocumentVault(root);

  try {
    const uploaded = await vault.createUploadedDocument({
      bytes: Buffer.from("%PDF-1.7\n"),
      description: "Uploaded for failure handling.",
      originalFilename: "locked.pdf",
      owner: "Maintenance Control",
      sourceType: "aviation",
      tags: ["locked"],
      title: "Locked Manual",
      type: "application/pdf",
    });

    await vault.failExtraction(uploaded.id, {
      code: "password_protected_pdf",
      message: "PDF requires a password.",
    });

    const failed = await vault.getDocumentById(uploaded.id);
    assert.equal(failed?.title, "Locked Manual");
    assert.equal(failed?.status, "blocked");
    assert.equal(failed?.extraction.status, "failed");
    assert.equal(failed?.extraction.error?.code, "password_protected_pdf");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("metadata edits persist normalized extraction state for legacy documents", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-vault-"));
  await mkdir(path.join(root, "uploads"), { recursive: true });
  await writeFile(
    path.join(root, "document-vault.json"),
    `${JSON.stringify({
      documents: [
        {
          id: "legacy-doc",
          title: "Legacy Manual",
          fileType: "PDF",
          size: "1 KB",
          sizeBytes: 1024,
          status: "processing",
          tags: ["legacy"],
          updatedAt: "Before Stage 2",
          owner: "Maintenance Control",
          sourceType: "aviation",
          pages: 0,
          description: "Record created before extraction fields existed.",
          storageKey: null,
          originalFilename: "legacy.pdf",
          mimeType: "application/pdf",
          customProperties: [],
        },
      ],
      activityEvents: [],
    })}\n`,
  );
  const vault = createLocalDocumentVault(root);

  try {
    await vault.updateDocumentMetadata("legacy-doc", {
      aircraftFamily: "Boeing 737NG",
      ata: "24",
      customProperties: [],
      description: "Edited legacy record.",
      effectivity: "737-700/800/900",
      manualType: "AMM",
      owner: "Maintenance Control",
      revision: "2026-06",
      sourceAuthority: "Boeing Aircraft Maintenance Manual",
      sourceType: "aviation",
      status: "processing",
      tags: ["legacy", "edited"],
      title: "Edited Legacy Manual",
    });

    const rawStore = JSON.parse(
      await readFile(path.join(root, "document-vault.json"), "utf8"),
    );
    assert.equal(rawStore.documents[0].extraction.status, "queued");
    assert.equal(rawStore.documents[0].aircraftFamily, "Boeing 737NG");
    assert.equal(rawStore.documents[0].manualType, "AMM");
    assert.equal(rawStore.documents[0].ata, "24");
    assert.equal(rawStore.documents[0].effectivity, "737-700/800/900");
    assert.equal(
      rawStore.documents[0].sourceAuthority,
      "Boeing Aircraft Maintenance Manual",
    );
    assert.equal(rawStore.documents[0].revision, "2026-06");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("local vault preserves concurrent uploads and metadata edits without corrupting JSON", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-vault-"));
  const vault = createLocalDocumentVault(root);

  try {
    const uploads = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        vault.createUploadedDocument({
          bytes: Buffer.from("%PDF-1.7\n"),
          description: `Concurrent upload ${index}.`,
          originalFilename: `manual-${index}.pdf`,
          owner: "Maintenance Control",
          sourceType: index % 2 === 0 ? "aviation" : "general",
          tags: [`batch-${index}`],
          title: `Concurrent Manual ${index}`,
          type: "application/pdf",
        }),
      ),
    );

    await Promise.all(
      uploads.map((document, index) =>
        vault.updateDocumentMetadata(document.id, {
          aircraftFamily: "Boeing 737NG",
          ata: "24",
          customProperties: [{ key: "Batch", value: String(index) }],
          description: `Edited concurrent upload ${index}.`,
          effectivity: "737-700/800/900",
          manualType: "AMM",
          owner: "Reliability Engineering",
          revision: "2026-06",
          sourceAuthority: "Boeing Aircraft Maintenance Manual",
          sourceType: document.sourceType,
          status: "ready",
          tags: [`batch-${index}`, "edited"],
          title: `Edited Concurrent Manual ${index}`,
        }),
      ),
    );

    const rawStore = await readFile(path.join(root, "document-vault.json"), "utf8");
    const parsedStore = JSON.parse(rawStore);
    const persistedIds = new Set(
      parsedStore.documents.map((document: { id: string }) => document.id),
    );

    for (const upload of uploads) {
      assert.equal(persistedIds.has(upload.id), true);
    }

    for (let index = 0; index < uploads.length; index += 1) {
      const persisted = parsedStore.documents.find(
        (document: { id: string }) => document.id === uploads[index]!.id,
      );
      assert.equal(persisted.title, `Edited Concurrent Manual ${index}`);
      assert.deepEqual(persisted.tags, [`batch-${index}`, "edited"]);
      assert.equal(persisted.status, "ready");
      assert.equal(persisted.aircraftFamily, "Boeing 737NG");
      assert.equal(persisted.manualType, "AMM");
    }
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

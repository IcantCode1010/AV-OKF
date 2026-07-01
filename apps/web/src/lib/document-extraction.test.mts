import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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

test("runExtractionJob can retry after a malformed PDF failure once stored bytes are corrected", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-extraction-"));
  const vault = createLocalDocumentVault(root);

  try {
    const uploaded = await vault.createUploadedDocument({
      bytes: Buffer.from("%PDF-1.7\nnot a structurally valid pdf"),
      description: "Malformed PDF retry test.",
      originalFilename: "malformed.pdf",
      owner: "Maintenance Control",
      sourceType: "aviation",
      tags: ["malformed"],
      title: "Malformed Manual",
      type: "application/pdf",
    });

    await runExtractionJob(uploaded.id, { vault });

    const failed = await vault.getDocumentById(uploaded.id);
    assert.equal(failed?.status, "blocked");
    assert.equal(failed?.extraction.status, "failed");
    assert.equal(failed?.extraction.error?.code, "malformed_pdf");

    await writeFile(
      path.join(root, "uploads", uploaded.storageKey),
      createOnePagePdf("RECOVERED MANUAL", "Recovered PDF text."),
    );

    await runExtractionJob(uploaded.id, { vault });

    const recovered = await vault.getDocumentById(uploaded.id);
    assert.equal(recovered?.status, "ready");
    assert.equal(recovered?.extraction.status, "completed");
    assert.match(
      recovered?.extraction.pageRecords[0]?.text ?? "",
      /RECOVERED MANUAL/,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

function createOnePagePdf(heading: string, body: string) {
  const stream = [
    "BT",
    `/F1 16 Tf 1 0 0 1 72 720 Tm (${escapePdfText(heading)}) Tj`,
    `/F1 11 Tf 1 0 0 1 72 686 Tm (${escapePdfText(body)}) Tj`,
    "ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [ 4 0 R ] /Count 1 >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>",
    `<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];

  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(pdf, "ascii"));
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, "ascii");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, "ascii");
}

function escapePdfText(text: string) {
  return text.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createLocalDocumentVault } from "./document-vault.ts";
import { runExtractionJob } from "./document-extraction.ts";

test("real multi-page PDF extracts text and generates heading topics despite repeated running headers", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-real-pdf-"));
  const vault = createLocalDocumentVault(root);

  try {
    const uploaded = await vault.createUploadedDocument({
      bytes: createManualPdfFixture(),
      description: "Real PDF pipeline fixture.",
      originalFilename: "real-maintenance-manual.pdf",
      owner: "Maintenance Control",
      sourceType: "aviation",
      tags: ["real-pdf", "pipeline"],
      title: "Real Maintenance Manual",
      type: "application/pdf",
    });

    await runExtractionJob(uploaded.id, { vault });

    const extracted = await vault.getDocumentById(uploaded.id);
    assert.equal(extracted?.status, "ready");
    assert.equal(extracted?.extraction.status, "completed");
    assert.equal(extracted?.extraction.pageRecords.length, 3);
    assert.match(
      extracted?.extraction.pageRecords[0]?.text ?? "",
      /ATA 24 ELECTRICAL POWER/,
    );

    const topics = await vault.generateTopicRecords(uploaded.id);
    const titles = topics.map((topic) => topic.title);

    assert.deepEqual(titles, [
      "ATA 24 ELECTRICAL POWER",
      "SECTION 2 FAULT ISOLATION",
    ]);
    assert.equal(
      titles.includes("AV-OKF Maintenance Manual"),
      false,
      "repeated running header must not become a topic",
    );
    assert.deepEqual(topics[0]?.sourcePageNumbers, [1, 2]);
    assert.deepEqual(topics[1]?.sourcePageNumbers, [3]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

function createManualPdfFixture() {
  return createPdf([
    [
      { text: "AV-OKF Maintenance Manual", size: 9, x: 72, y: 752 },
      { text: "ATA 24 ELECTRICAL POWER", size: 16, x: 72, y: 697 },
      {
        text: "Generator bus procedure details support maintenance dispatch checks.",
        size: 11,
        x: 72,
        y: 663,
      },
      {
        text: "The left and right transfer buses supply related loads.",
        size: 11,
        x: 72,
        y: 645,
      },
      { text: "Page 1", size: 9, x: 72, y: 40 },
    ],
    [
      { text: "AV-OKF Maintenance Manual", size: 9, x: 72, y: 752 },
      {
        text: "Generator bus procedure details continue with normal power distribution.",
        size: 11,
        x: 72,
        y: 697,
      },
      {
        text: "A repeated running header should not become a topic boundary.",
        size: 11,
        x: 72,
        y: 679,
      },
      { text: "Page 2", size: 9, x: 72, y: 40 },
    ],
    [
      { text: "AV-OKF Maintenance Manual", size: 9, x: 72, y: 752 },
      { text: "SECTION 2 FAULT ISOLATION", size: 16, x: 72, y: 697 },
      {
        text: "Fault isolation details describe steps after an electrical power fault.",
        size: 11,
        x: 72,
        y: 663,
      },
      {
        text: "The corrective action references inspection and reset conditions.",
        size: 11,
        x: 72,
        y: 645,
      },
      { text: "Page 3", size: 9, x: 72, y: 40 },
    ],
  ]);
}

type PdfLine = {
  text: string;
  size: number;
  x: number;
  y: number;
};

function createPdf(pages: PdfLine[][]) {
  const objects: string[] = [];
  const pageObjectNumbers: number[] = [];

  objects[0] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[1] = "";
  objects[2] =
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";

  for (const page of pages) {
    const pageObjectNumber = objects.length + 1;
    const contentObjectNumber = pageObjectNumber + 1;
    pageObjectNumbers.push(pageObjectNumber);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`,
    );

    const stream = `BT\n${page.map(drawTextLine).join("\n")}\nET`;
    objects.push(`<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}\nendstream`);
  }

  objects[1] =
    `<< /Type /Pages /Kids [${pageObjectNumbers.map((objectNumber) => ` ${objectNumber} 0 R`).join("")} ] /Count ${pages.length} >>`;

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

function drawTextLine(line: PdfLine) {
  return `/F1 ${line.size} Tf 1 0 0 1 ${line.x} ${line.y} Tm (${escapePdfText(line.text)}) Tj`;
}

function escapePdfText(text: string) {
  return text.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

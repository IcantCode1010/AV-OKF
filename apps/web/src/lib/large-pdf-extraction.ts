import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { promisify } from "node:util";

import { MAX_LARGE_PDF_PAGES, MAX_LARGE_PDF_UPLOAD_BYTES } from "./document-upload-limits.ts";
import { getPrisma } from "./prisma.ts";
import type { ObjectStorage } from "./production-storage.ts";

const execFileAsync = promisify(execFile);
const EXTRACTION_BATCH_PAGES = 20;
const MIN_MEANINGFUL_TEXT = 20;
const MIN_ACCEPTABLE_OCR_CONFIDENCE = 45;

export type PdfInspection = {
  encrypted: boolean;
  pageCount: number;
  rasterPages: Set<number>;
  warnings: string[];
};

export type ExtractedLargePdfPage = {
  charCount: number;
  extractionMethod: "digital" | "ocr" | "blank" | "unreadable";
  imageCount: number;
  ocrConfidence: number | null;
  pageNumber: number;
  tables: never[];
  text: string;
  warningCodes: string[];
};

export async function runLargePdfExtraction(input: {
  documentId: string;
  extractionJobId: string;
  objectKey: string;
  storage: ObjectStorage;
  workspaceId: string;
}) {
  const db = getPrisma();
  const scratchRoot = process.env.PDF_SCRATCH_ROOT ?? tmpdir();
  await mkdir(scratchRoot, { recursive: true });
  const scratch = await mkdtemp(path.join(scratchRoot, "av-okf-pdf-"));
  try {
    let inspectionCheckpoint = await db.documentProcessingCheckpoint.findUnique({
      where: { jobId_stage_batchIndex: { batchIndex: 0, jobId: input.extractionJobId, stage: "inspection" } },
    });
    if (inspectionCheckpoint?.status !== "completed") {
      const sourcePath = path.join(scratch, "source.pdf");
      const digest = await streamObjectToFileAndHash(input.storage, input.objectKey, sourcePath);
      const size = (await stat(sourcePath)).size;
      if (size > MAX_LARGE_PDF_UPLOAD_BYTES) throw new Error("pdf_exceeds_250mb_limit");
      const inspection = await inspectPdf(sourcePath);
      if (inspection.encrypted) throw new Error("password_protected_pdf");
      if (inspection.pageCount > MAX_LARGE_PDF_PAGES) throw new Error("pdf_exceeds_5000_page_limit");
      await stageBatchObjects({ ...input, digest, inspection, scratch, sourcePath });
      inspectionCheckpoint = await db.documentProcessingCheckpoint.upsert({
        create: {
          attempts: 1, batchIndex: 0, completedAt: new Date(), documentId: input.documentId,
          jobId: input.extractionJobId, outputHash: digest, pageEnd: inspection.pageCount,
          pageStart: 1, stage: "inspection", status: "completed",
        },
        update: { attempts: { increment: 1 }, completedAt: new Date(), errorCode: null, outputHash: digest, pageEnd: inspection.pageCount, status: "completed" },
        where: { jobId_stage_batchIndex: { batchIndex: 0, jobId: input.extractionJobId, stage: "inspection" } },
      });
      await db.document.update({
        data: { contentSha256: digest, inspectedAt: new Date(), inspectionStatus: "completed", inspectionWarnings: inspection.warnings, pages: inspection.pageCount },
        where: { id: input.documentId },
      });
    }

    const checkpoints = await db.documentProcessingCheckpoint.findMany({
      orderBy: { batchIndex: "asc" },
      where: { jobId: input.extractionJobId, stage: "extraction" },
    });
    for (const checkpoint of checkpoints) {
      if (checkpoint.status === "completed") continue;
      if (!checkpoint.outputKey) throw new Error("extraction_batch_object_missing");
      await db.documentProcessingCheckpoint.update({
        data: { attempts: { increment: 1 }, errorCode: null, startedAt: new Date(), status: "running" },
        where: { id: checkpoint.id },
      });
      const batchPath = path.join(scratch, `batch-${checkpoint.batchIndex}.pdf`);
      await pipeline(await input.storage.getObjectStream(checkpoint.outputKey), createWriteStream(batchPath));
      try {
        const pages = await extractBatch(batchPath, checkpoint.pageStart, checkpoint.pageEnd, scratch);
        const outputHash = createHash("sha256").update(JSON.stringify(pages)).digest("hex");
        await db.$transaction(async (tx) => {
          for (const page of pages) {
            await tx.extractedPage.upsert({
              create: { ...page, documentId: input.documentId, workspaceId: input.workspaceId },
              update: page,
              where: { documentId_pageNumber: { documentId: input.documentId, pageNumber: page.pageNumber } },
            });
          }
          await tx.documentProcessingCheckpoint.update({
            data: { completedAt: new Date(), errorCode: null, outputHash, status: "completed" },
            where: { id: checkpoint.id },
          });
        });
        await input.storage.deleteObject(checkpoint.outputKey);
      } catch (error) {
        await db.documentProcessingCheckpoint.update({
          data: { errorCode: error instanceof Error ? error.message : "batch_extraction_failed", status: "failed" },
          where: { id: checkpoint.id },
        });
        throw error;
      }
    }

    const unreadable = await db.extractedPage.findMany({
      select: { pageNumber: true },
      where: { documentId: input.documentId, extractionMethod: "unreadable" },
    });
    const ocrPageCount = await db.extractedPage.count({ where: { documentId: input.documentId, extractionMethod: "ocr" } });
    const completedAt = new Date();
    await db.$transaction(async (tx) => {
      const document = await tx.document.update({
        data: {
          inspectionStatus: unreadable.length ? "action_required" : "completed",
          ocrPageCount,
          status: unreadable.length ? "blocked" : "ready",
          unreadablePageNumbers: unreadable.map(({ pageNumber }) => pageNumber),
          updatedLabel: "Just now",
        },
        where: { id: input.documentId },
      });
      await tx.extractionJob.update({ data: { completedAt, status: "completed" }, where: { id: input.extractionJobId } });
      await tx.extractionLog.create({ data: {
        documentId: input.documentId, jobId: input.extractionJobId,
        level: unreadable.length ? "warning" : "info",
        message: unreadable.length
          ? `Extraction completed with ${unreadable.length} unreadable pages requiring review.`
          : `Extraction completed with ${inspectionCheckpoint.pageEnd} page records.`,
        workspaceId: input.workspaceId,
      } });
      await tx.activityEvent.create({ data: {
        documentId: input.documentId, documentTitle: document.title,
        label: unreadable.length ? "Extraction needs attention" : "Extraction completed",
        status: unreadable.length ? "needs_review" : "ready", timestamp: "Just now", workspaceId: input.workspaceId,
      } });
    });
    return { pageCount: inspectionCheckpoint.pageEnd, unreadablePages: unreadable.map(({ pageNumber }) => pageNumber) };
  } finally {
    await rm(scratch, { force: true, recursive: true });
  }
}

export async function inspectPdf(pdfPath: string): Promise<PdfInspection> {
  const warnings: string[] = [];
  try {
    await execFileAsync("qpdf", ["--check", pdfPath], { maxBuffer: 2 * 1024 * 1024 });
  } catch (error) {
    const classification = classifyQpdfCheckError(error);
    if (classification === "password_protected") throw new Error("password_protected_pdf");
    if (classification === "malformed") throw new Error("malformed_pdf");
    warnings.push("qpdf_recoverable_warnings");
  }
  const { stdout } = await execFileAsync("pdfinfo", [pdfPath], { maxBuffer: 2 * 1024 * 1024 });
  const pageCount = Number(/^Pages:\s+(\d+)/mi.exec(stdout)?.[1] ?? 0);
  const encrypted = /^Encrypted:\s+yes/mi.test(stdout);
  if (!Number.isInteger(pageCount) || pageCount < 1) throw new Error("malformed_pdf");
  const rasterPages = await listRasterPages(pdfPath);
  return { encrypted, pageCount, rasterPages, warnings };
}

export function classifyQpdfCheckError(error: unknown): "recoverable_warnings" | "password_protected" | "malformed" {
  const value = error && typeof error === "object"
    ? error as { code?: number | string }
    : {};
  if (Number(value.code) === 3) return "recoverable_warnings";
  const message = commandErrorText(error).toLowerCase();
  if (
    message.includes("invalid password") ||
    message.includes("password required") ||
    message.includes("requires a password") ||
    message.includes("incorrect password")
  ) return "password_protected";
  return "malformed";
}

export function classifyExtractedPage(input: {
  digitalText: string;
  hasRaster: boolean;
  ocrConfidence?: number | null;
  ocrText?: string;
}): Pick<ExtractedLargePdfPage, "extractionMethod" | "ocrConfidence" | "text" | "warningCodes"> {
  const digitalText = cleanText(input.digitalText);
  if (meaningfulLength(digitalText) >= MIN_MEANINGFUL_TEXT) {
    return { extractionMethod: "digital", ocrConfidence: null, text: digitalText, warningCodes: [] };
  }
  if (!input.hasRaster) {
    return { extractionMethod: "blank", ocrConfidence: null, text: digitalText, warningCodes: digitalText ? ["sparse_digital_text"] : [] };
  }
  const ocrText = cleanText(input.ocrText ?? "");
  const confidence = input.ocrConfidence ?? 0;
  if (meaningfulLength(ocrText) >= MIN_MEANINGFUL_TEXT && confidence >= MIN_ACCEPTABLE_OCR_CONFIDENCE) {
    return { extractionMethod: "ocr", ocrConfidence: confidence, text: ocrText, warningCodes: confidence < 60 ? ["low_ocr_confidence"] : [] };
  }
  return { extractionMethod: "unreadable", ocrConfidence: confidence, text: ocrText, warningCodes: ["ocr_unreadable"] };
}

async function stageBatchObjects(input: {
  digest: string; documentId: string; extractionJobId: string; inspection: PdfInspection;
  scratch: string; sourcePath: string; storage: ObjectStorage; workspaceId: string;
}) {
  const db = getPrisma();
  for (let pageStart = 1, batchIndex = 0; pageStart <= input.inspection.pageCount; pageStart += EXTRACTION_BATCH_PAGES, batchIndex += 1) {
    const pageEnd = Math.min(input.inspection.pageCount, pageStart + EXTRACTION_BATCH_PAGES - 1);
    const batchPath = path.join(input.scratch, `staged-${batchIndex}.pdf`);
    await execFileAsync("qpdf", [input.sourcePath, "--pages", input.sourcePath, `${pageStart}-${pageEnd}`, "--", batchPath]);
    const outputKey = `workspaces/${input.workspaceId}/documents/${input.documentId}/processing/${input.extractionJobId}/batch-${batchIndex}.pdf`;
    const size = (await stat(batchPath)).size;
    await input.storage.putObject({ body: createReadStream(batchPath), contentLength: size, contentType: "application/pdf", key: outputKey });
    await db.documentProcessingCheckpoint.upsert({
      create: { batchIndex, documentId: input.documentId, jobId: input.extractionJobId, outputKey, pageEnd, pageStart, stage: "extraction", status: "queued" },
      update: { outputKey, pageEnd, pageStart },
      where: { jobId_stage_batchIndex: { batchIndex, jobId: input.extractionJobId, stage: "extraction" } },
    });
  }
}

async function extractBatch(batchPath: string, absoluteStart: number, absoluteEnd: number, scratch: string) {
  const rasterPages = await listRasterPages(batchPath);
  const pages: ExtractedLargePdfPage[] = [];
  for (let localPage = 1; localPage <= absoluteEnd - absoluteStart + 1; localPage += 1) {
    const { stdout: digitalText } = await execFileAsync("pdftotext", ["-f", String(localPage), "-l", String(localPage), "-layout", batchPath, "-"], { maxBuffer: 20 * 1024 * 1024 });
    let ocrText = "";
    let ocrConfidence: number | null = null;
    if (meaningfulLength(digitalText) < MIN_MEANINGFUL_TEXT && rasterPages.has(localPage)) {
      const prefix = path.join(scratch, `ocr-${absoluteStart + localPage - 1}`);
      await execFileAsync("pdftoppm", ["-f", String(localPage), "-l", String(localPage), "-r", "300", "-gray", "-png", "-singlefile", batchPath, prefix]);
      let result = await tesseractTsv(`${prefix}.png`, "6");
      if (result.confidence < MIN_ACCEPTABLE_OCR_CONFIDENCE) {
        const enhanced = `${prefix}-enhanced.png`;
        await execFileAsync("convert", [`${prefix}.png`, "-deskew", "40%", "-contrast-stretch", "1%x1%", enhanced]);
        result = await tesseractTsv(enhanced, "3");
      }
      ocrText = result.text;
      ocrConfidence = result.confidence;
    }
    const classified = classifyExtractedPage({ digitalText, hasRaster: rasterPages.has(localPage), ocrConfidence, ocrText });
    pages.push({
      ...classified,
      charCount: classified.text.length,
      imageCount: rasterPages.has(localPage) ? 1 : 0,
      pageNumber: absoluteStart + localPage - 1,
      tables: [],
    });
  }
  return pages;
}

async function tesseractTsv(imagePath: string, psm: string) {
  const { stdout } = await execFileAsync("tesseract", [imagePath, "stdout", "-l", "eng", "--psm", psm, "tsv"], { maxBuffer: 50 * 1024 * 1024 });
  const words: string[] = [];
  const confidences: number[] = [];
  for (const line of stdout.split(/\r?\n/).slice(1)) {
    const columns = line.split("\t");
    const confidence = Number(columns[10]);
    const word = columns.slice(11).join("\t").trim();
    if (word) words.push(word);
    if (word && confidence >= 0) confidences.push(confidence);
  }
  return { confidence: confidences.length ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length : 0, text: words.join(" ") };
}

async function listRasterPages(pdfPath: string) {
  try {
    const { stdout } = await execFileAsync("pdfimages", ["-list", pdfPath], { maxBuffer: 10 * 1024 * 1024 });
    const pages = new Set<number>();
    for (const line of stdout.split(/\r?\n/)) {
      const match = /^\s*(\d+)\s+\d+\s+/.exec(line);
      if (match) pages.add(Number(match[1]));
    }
    return pages;
  } catch {
    return new Set<number>();
  }
}

async function streamObjectToFileAndHash(storage: ObjectStorage, objectKey: string, destination: string) {
  const hash = createHash("sha256");
  const meter = new Transform({ transform(chunk, _encoding, callback) { hash.update(chunk); callback(null, chunk); } });
  await pipeline(await storage.getObjectStream(objectKey), meter, createWriteStream(destination));
  return hash.digest("hex");
}

function cleanText(value: string) { return value.replace(/\r\n?/g, "\n").replace(/[\t ]+/g, " ").trim(); }
function meaningfulLength(value: string) { return value.replace(/[^\p{L}\p{N}]/gu, "").length; }
function commandErrorText(error: unknown) {
  if (!error || typeof error !== "object") return String(error);
  const value = error as { message?: string; stderr?: string; stdout?: string };
  return [value.message, value.stderr, value.stdout].filter(Boolean).join("\n");
}

import path from "node:path";
import { pathToFileURL } from "node:url";

import type { ExtractedPageRecord } from "./document-vault.ts";

type TextItem = {
  str: string;
  transform?: unknown;
};

type TextLine = {
  y: number;
  items: Array<{
    x: number;
    text: string;
  }>;
};

const LINE_Y_TOLERANCE = 2;

export async function extractPdfPages(bytes: Buffer): Promise<ExtractedPageRecord[]> {
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    configurePdfWorker(pdfjs);
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(bytes),
      useSystemFonts: true,
    });
    const pdf = await loadingTask.promise;
    const pageRecords: ExtractedPageRecord[] = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const text = buildPageText(textContent.items);

      pageRecords.push({
        pageNumber,
        text,
        tables: [],
        imageCount: 0,
        charCount: text.length,
      });
    }

    if ("destroy" in pdf && typeof pdf.destroy === "function") {
      await pdf.destroy();
    } else {
      await loadingTask.destroy();
    }
    return pageRecords;
  } catch (error) {
    throw normalizePdfError(error);
  }
}

function configurePdfWorker(pdfjs: {
  GlobalWorkerOptions?: { workerSrc?: string };
}) {
  if (!pdfjs.GlobalWorkerOptions) {
    return;
  }

  const workerPath = path.join(
    process.cwd(),
    "node_modules",
    "pdfjs-dist",
    "legacy",
    "build",
    "pdf.worker.mjs",
  );
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).toString();
}

function buildPageText(items: unknown[]) {
  const lines: TextLine[] = [];
  const unpositionedText: string[] = [];

  for (const item of items) {
    if (!item || typeof item !== "object" || !("str" in item)) {
      continue;
    }

    const textItem = item as TextItem;
    const text = textItem.str.replace(/\s+/g, " ").trim();

    if (!text) {
      continue;
    }

    const transform = Array.isArray(textItem.transform)
      ? textItem.transform
      : null;
    const x = typeof transform?.[4] === "number" ? transform[4] : null;
    const y = typeof transform?.[5] === "number" ? transform[5] : null;

    if (x === null || y === null) {
      unpositionedText.push(text);
      continue;
    }

    const line = findOrCreateLine(lines, y);
    line.items.push({ x, text });
  }

  const positionedLines = lines
    .sort((left, right) => right.y - left.y)
    .map((line) =>
      line.items
        .sort((left, right) => left.x - right.x)
        .map((part) => part.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);

  return [...positionedLines, ...unpositionedText]
    .join("\n")
    .replace(/-\n(?=[a-z])/g, "")
    .trim();
}

function findOrCreateLine(lines: TextLine[], y: number) {
  const existingLine = lines.find(
    (line) => Math.abs(line.y - y) <= LINE_Y_TOLERANCE,
  );

  if (existingLine) {
    return existingLine;
  }

  const line: TextLine = { y, items: [] };
  lines.push(line);
  return line;
}

function normalizePdfError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown PDF error.";
  const lower = message.toLowerCase();

  if (lower.includes("password")) {
    return new Error("password_protected_pdf");
  }

  if (
    lower.includes("invalid") ||
    lower.includes("corrupt") ||
    lower.includes("xref") ||
    lower.includes("trailer")
  ) {
    return new Error("malformed_pdf");
  }

  return error instanceof Error ? error : new Error(message);
}

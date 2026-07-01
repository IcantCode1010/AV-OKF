import type { ExtractedPageRecord } from "./document-vault.ts";

type TextItem = {
  str: string;
};

export async function extractPdfPages(bytes: Buffer): Promise<ExtractedPageRecord[]> {
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(bytes),
      useSystemFonts: true,
    });
    const pdf = await loadingTask.promise;
    const pageRecords: ExtractedPageRecord[] = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const text = textContent.items
        .map((item) => ("str" in item ? (item as TextItem).str : ""))
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

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

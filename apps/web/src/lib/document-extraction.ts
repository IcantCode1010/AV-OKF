import {
  completeExtraction,
  failExtraction,
  getDocumentPdfBytes,
  startExtraction,
  type ExtractedPageRecord,
  type createLocalDocumentVault,
} from "./document-vault.ts";

type VaultLike = Pick<
  ReturnType<typeof createLocalDocumentVault>,
  "completeExtraction" | "failExtraction" | "getDocumentPdfBytes" | "startExtraction"
>;

type ExtractionJobOptions = {
  extractPdfPages?: (bytes: Buffer) => Promise<ExtractedPageRecord[]>;
  vault?: VaultLike;
};

const defaultVault: VaultLike = {
  completeExtraction,
  failExtraction,
  getDocumentPdfBytes,
  startExtraction,
};

export async function runExtractionJob(
  documentId: string,
  options: ExtractionJobOptions = {},
) {
  const vault = options.vault ?? defaultVault;

  try {
    await vault.startExtraction(documentId);
    const bytes = await vault.getDocumentPdfBytes(documentId);
    const extractPdfPages =
      options.extractPdfPages ?? (await import("./pdf-text-extractor.ts")).extractPdfPages;
    const pageRecords = await extractPdfPages(bytes);
    await vault.completeExtraction(documentId, { pageRecords });
  } catch (error) {
    await vault.failExtraction(documentId, normalizeExtractionError(error));
  }
}

export function startDetachedExtraction(documentId: string) {
  void runExtractionJob(documentId);
}

function normalizeExtractionError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown extraction error.";
  const normalized = message.toLowerCase();

  if (normalized.includes("password")) {
    return {
      code: "password_protected_pdf",
      message: "PDF appears to be password-protected and cannot be extracted.",
    };
  }

  if (
    normalized.includes("malformed") ||
    normalized.includes("invalid") ||
    normalized.includes("corrupt") ||
    normalized.includes("xref") ||
    normalized.includes("trailer")
  ) {
    return {
      code: "malformed_pdf",
      message: "PDF appears malformed or corrupt and could not be extracted.",
    };
  }

  if (normalized.includes("document_has_no_stored_pdf")) {
    return {
      code: "missing_stored_pdf",
      message: "Document does not have a stored PDF file to extract.",
    };
  }

  return {
    code: "extraction_failed",
    message,
  };
}

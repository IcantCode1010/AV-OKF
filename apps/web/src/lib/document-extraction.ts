import {
  completeExtraction,
  failExtraction,
  getDocumentPdfBytes,
  startExtraction,
  type ExtractedPageRecord,
  type createLocalDocumentVault,
} from "./document-vault.ts";
import { normalizeExtractionError } from "./extraction-errors.ts";

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

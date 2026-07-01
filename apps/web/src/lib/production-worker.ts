import { normalizeExtractionError } from "./extraction-errors.ts";
import type { ExtractedPageRecord, ExtractionError } from "./document-vault.ts";
import type { ObjectStorage } from "./production-storage.ts";

export type ProductionExtractionJobPayload = {
  documentId: string;
  extractionJobId: string;
  workspaceId: string;
};

type ProductionExtractionRepository = {
  completeExtractionJob(input: {
    documentId: string;
    extractionJobId: string;
    pageRecords: ExtractedPageRecord[];
    workspaceId: string;
  }): Promise<void>;
  failExtractionJob(input: {
    documentId: string;
    error: ExtractionError;
    extractionJobId: string;
    workspaceId: string;
  }): Promise<void>;
  getPrimaryDocumentObject(input: {
    documentId: string;
    workspaceId: string;
  }): Promise<{ objectKey: string }>;
  startExtractionJob(input: {
    documentId: string;
    extractionJobId: string;
    workspaceId: string;
  }): Promise<void>;
};

type RunProductionExtractionJobOptions = {
  extractPdfPages?: (bytes: Buffer) => Promise<ExtractedPageRecord[]>;
  repository: ProductionExtractionRepository;
  storage: Pick<ObjectStorage, "getObject">;
};

export async function runProductionExtractionJob(
  payload: ProductionExtractionJobPayload,
  options: RunProductionExtractionJobOptions,
) {
  try {
    await options.repository.startExtractionJob(payload);
    const object = await options.repository.getPrimaryDocumentObject(payload);
    const bytes = await options.storage.getObject(object.objectKey);
    const extractPdfPages =
      options.extractPdfPages ?? (await import("./pdf-text-extractor.ts")).extractPdfPages;
    const pageRecords = await extractPdfPages(bytes);

    await options.repository.completeExtractionJob({
      ...payload,
      pageRecords,
    });
  } catch (error) {
    await options.repository.failExtractionJob({
      ...payload,
      error: normalizeExtractionError(error),
    });
  }
}

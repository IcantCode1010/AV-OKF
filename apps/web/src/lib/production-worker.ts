import { normalizeExtractionError } from "./extraction-errors.ts";
import { getDefaultChunkingStrategyId } from "./rag-reindex.ts";
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
  createRagIndexJobAfterExtraction?(input: {
    documentId: string;
    extractionJobId: string;
    workspaceId: string;
  }): Promise<{
    documentId: string;
    id: string;
    indexVersion: number;
    workspaceId: string;
  }>;
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
  ragQueue?: {
    enqueueIndexJob(input: {
      chunkingStrategyId?: string;
      documentId: string;
      indexJobId: string;
      indexVersion: number;
      mode?: "initial" | "reindex";
      workspaceId: string;
    }): Promise<void>;
  };
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

    if (options.ragQueue && options.repository.createRagIndexJobAfterExtraction) {
      try {
        const indexJob =
          await options.repository.createRagIndexJobAfterExtraction(payload);
        await options.ragQueue.enqueueIndexJob({
          chunkingStrategyId: getDefaultChunkingStrategyId(),
          documentId: indexJob.documentId,
          indexJobId: indexJob.id,
          indexVersion: indexJob.indexVersion,
          mode: "initial",
          workspaceId: indexJob.workspaceId,
        });
      } catch (error) {
        console.error(
          "RAG index enqueue failed; queued job remains in Postgres.",
          error,
        );
      }
    }
  } catch (error) {
    await options.repository.failExtractionJob({
      ...payload,
      error: normalizeExtractionError(error),
    });
  }
}

import type { ExtractedPageRecord } from "./document-vault.ts";

export type RagIndexStatus =
  | "not_indexed"
  | "queued"
  | "deleting_old_chunks"
  | "chunking"
  | "embedding"
  | "running"
  | "indexed"
  | "index_failed"
  | "failed";

export type RagIndexJobStatus = "queued" | "running" | "completed" | "failed";

export type RagIndexErrorCode =
  | "chunking_failed"
  | "embedding_budget_exceeded"
  | "embedding_provider_failed"
  | "vector_store_failed"
  | "indexing_failed";

export type RagChunkRecord = {
  id: string;
  workspaceId: string;
  documentId: string;
  indexJobId: string;
  indexVersion: number;
  chunkingStrategyId?: string | null;
  chunkOrdinal: number;
  text: string;
  contentHash: string;
  tokenCount: number;
  pageStart: number;
  pageEnd: number;
  sourcePageNumbers: number[];
  headingPath: string[];
  reviewStatus: "raw_extracted";
};

export type RagChunkInput = {
  documentId: string;
  indexJobId: string;
  indexVersion: number;
  pages: ExtractedPageRecord[];
  workspaceId: string;
};

export const RAG_REINDEX_IN_FLIGHT_STATUSES = [
  "queued",
  "deleting_old_chunks",
  "chunking",
  "embedding",
] as const;

export type ReindexDocumentRow = {
  id: string;
  title: string;
  sizeBytes: number;
  sizeLabel: string;
  chunkingStrategyId: string | null;
  lastIndexedAt: Date | null;
  chunkCount: number;
  ragStatus: RagIndexStatus | string;
  latestError: string | null;
};

export type RetrievalMode = "hybrid" | "vector" | "keyword";

export type RetrievalRequest = {
  documentIds?: string[];
  filters?: {
    documentIds?: string[];
    pageNumbers?: number[];
    reviewStatus?: string[];
    sourceTypes?: string[];
  };
  mode: RetrievalMode;
  query: string;
  topK: number;
  workspaceId: string;
};

export type RetrievalResult = {
  chunkId: string;
  coveredByOkfConceptIds: string[];
  documentId: string;
  documentTitle: string;
  pageEnd: number;
  pageStart: number;
  retrievalMode: RetrievalMode;
  reviewStatus: string;
  score: number;
  sourcePageNumbers: number[];
  text: string;
};

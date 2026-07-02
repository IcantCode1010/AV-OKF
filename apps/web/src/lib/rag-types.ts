import type { ExtractedPageRecord } from "./document-vault.ts";

export type RagIndexStatus =
  | "not_indexed"
  | "queued"
  | "running"
  | "indexed"
  | "index_failed";

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

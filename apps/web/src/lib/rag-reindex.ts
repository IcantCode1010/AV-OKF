import { RAG_CHUNK_STRATEGIES } from "./rag-chunker.ts";
import { createRagRepository } from "./rag-repository.ts";
import { getRagIndexQueue } from "./rag-queue.ts";
import type { AuthWorkspaceContext } from "./auth-workspace.ts";
import type { ReindexDocumentRow } from "./rag-types.ts";

export type ReindexAdminState = {
  activeDocument: ReindexDocumentRow | null;
  documents: ReindexDocumentRow[];
};

type ReindexRepository = {
  createReindexJob(input: {
    chunkingStrategyId: string;
    documentId: string;
    workspaceId: string;
  }): Promise<{
    documentId: string;
    id: string;
    indexVersion: number;
    workspaceId: string;
  }>;
};

type ReindexQueue = {
  enqueueIndexJob(input: {
    chunkingStrategyId: string;
    documentId: string;
    indexJobId: string;
    indexVersion: number;
    mode: "reindex";
    workspaceId: string;
  }): Promise<void>;
};

export function getDefaultChunkingStrategyId() {
  return RAG_CHUNK_STRATEGIES[0].id;
}

export function isKnownChunkingStrategyId(strategyId: string) {
  return RAG_CHUNK_STRATEGIES.some((strategy) => strategy.id === strategyId);
}

export function formatChunkingStrategyLabel(strategyId?: string | null) {
  if (!strategyId) {
    return "unknown";
  }

  if (strategyId === "paragraph-v1") {
    return "Paragraph-granular (v1)";
  }

  return (
    RAG_CHUNK_STRATEGIES.find((strategy) => strategy.id === strategyId)?.label ??
    "unknown"
  );
}

export async function getReindexAdminState(
  context: AuthWorkspaceContext,
  repository = createRagRepository(),
): Promise<ReindexAdminState> {
  const documents = await repository.listReindexDocuments({
    workspaceId: context.workspaceId,
  });

  return {
    activeDocument:
      documents.find((document) => isReindexInFlight(document.ragStatus)) ?? null,
    documents,
  };
}

export async function requestDocumentReindex(input: {
  chunkingStrategyId: string;
  context: AuthWorkspaceContext;
  documentId: string;
  queue?: ReindexQueue;
  repository?: ReindexRepository;
}) {
  if (!isKnownChunkingStrategyId(input.chunkingStrategyId)) {
    throw new Error("unknown_chunking_strategy");
  }

  const repository = input.repository ?? createRagRepository();
  const queue = input.queue ?? getRagIndexQueue();
  const job = await repository.createReindexJob({
    chunkingStrategyId: input.chunkingStrategyId,
    documentId: input.documentId,
    workspaceId: input.context.workspaceId,
  });

  await queue.enqueueIndexJob({
    chunkingStrategyId: input.chunkingStrategyId,
    documentId: job.documentId,
    indexJobId: job.id,
    indexVersion: job.indexVersion,
    mode: "reindex",
    workspaceId: job.workspaceId,
  });
}

function isReindexInFlight(status: string) {
  return ["queued", "deleting_old_chunks", "chunking", "embedding"].includes(
    status,
  );
}

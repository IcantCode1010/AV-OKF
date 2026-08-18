import { randomUUID } from "node:crypto";

import type { Prisma } from "@prisma/client";

import { getEmbeddingProvider } from "./embedding-provider.ts";
import { EmbeddingBudgetExceededError } from "./rag-budget.ts";
import { chunkExtractedPages } from "./rag-chunker.ts";
import { createRagRepository } from "./rag-repository.ts";
import type { RagIndexJobPayload, } from "./rag-queue.ts";
import type { RagChunkRecord } from "./rag-types.ts";
import { getPrisma } from "./prisma.ts";

const PAGE_BATCH_SIZE = 20;
const MAX_EMBEDDING_BATCH_CHUNKS = 64;
const MAX_EMBEDDING_BATCH_TOKENS = 50_000;

export async function runBatchedRagIndexJob(payload: RagIndexJobPayload) {
  const db = getPrisma();
  const repository = createRagRepository();
  const provider = getEmbeddingProvider();
  const document = await db.document.findFirst({
    select: { pages: true, title: true, unreadablePageNumbers: true },
    where: { deletedAt: null, id: payload.documentId, workspaceId: payload.workspaceId },
  });
  if (!document) throw new Error("document_not_found");
  if (document.unreadablePageNumbers.length) throw new Error("rag_requires_all_readable_pages");

  await db.ragIndexJob.update({ data: { attempts: { increment: 1 }, startedAt: new Date(), status: "running" }, where: { id: payload.indexJobId } });
  await db.document.update({ data: { ragStatus: "chunking" }, where: { id: payload.documentId } });

  const chunks: RagChunkRecord[] = [];
  let ordinal = 0;
  for (let pageStart = 1; pageStart <= document.pages; pageStart += PAGE_BATCH_SIZE) {
    const rows = await db.extractedPage.findMany({
      orderBy: { pageNumber: "asc" },
      where: { documentId: payload.documentId, pageNumber: { gte: pageStart, lt: pageStart + PAGE_BATCH_SIZE } },
    });
    const pageChunks = chunkExtractedPages({
      documentId: payload.documentId,
      documentTitle: document.title,
      indexJobId: payload.indexJobId,
      indexVersion: payload.indexVersion,
      pages: rows.map((page) => ({ charCount: page.charCount, imageCount: page.imageCount, pageNumber: page.pageNumber, tables: [], text: page.text })),
      workspaceId: payload.workspaceId,
    });
    for (const chunk of pageChunks) {
      const chunkOrdinal = ordinal++;
      chunks.push({
        ...chunk,
        chunkOrdinal,
        id: `rag_${payload.documentId}_${payload.indexVersion}_${chunk.pageStart}_${chunkOrdinal}_${chunk.contentHash.slice(0, 12)}`,
      });
    }
  }

  const readableNonblankPages = await db.extractedPage.findMany({
    select: { pageNumber: true },
    where: { charCount: { gt: 0 }, documentId: payload.documentId, extractionMethod: { not: "unreadable" } },
  });
  const representedPages = new Set(chunks.flatMap((chunk) => chunk.sourcePageNumbers));
  const missingPages = readableNonblankPages.filter(({ pageNumber }) => !representedPages.has(pageNumber));
  if (missingPages.length) throw new Error(`rag_page_coverage_incomplete:${missingPages.map(({ pageNumber }) => pageNumber).join(",")}`);

  const batches = packEmbeddingBatches(chunks);
  for (const [batchIndex, batch] of batches.entries()) {
    const tokenCount = batch.reduce((sum, chunk) => sum + chunk.tokenCount, 0);
    const checkpoint = await db.ragIndexBatchCheckpoint.upsert({
      create: { batchIndex, chunkEnd: batch.at(-1)!.chunkOrdinal, chunkStart: batch[0]!.chunkOrdinal, indexJobId: payload.indexJobId, status: "queued", tokenCount },
      update: { chunkEnd: batch.at(-1)!.chunkOrdinal, chunkStart: batch[0]!.chunkOrdinal, tokenCount },
      where: { indexJobId_batchIndex: { batchIndex, indexJobId: payload.indexJobId } },
    });
    if (checkpoint.status === "completed") continue;
    try {
      await repository.reserveIndexJobBudget({ indexJobId: payload.indexJobId, tokenEstimate: tokenCount, workspaceId: payload.workspaceId });
    } catch (error) {
      if (error instanceof EmbeddingBudgetExceededError) {
        await db.$transaction([
          db.ragIndexBatchCheckpoint.update({ data: { errorCode: error.code, status: "awaiting_budget" }, where: { id: checkpoint.id } }),
          db.ragIndexJob.update({ data: { errorCode: error.code, errorMessage: error.message, status: "awaiting_budget" }, where: { id: payload.indexJobId } }),
          db.document.update({ data: { ragStatus: "awaiting_budget" }, where: { id: payload.documentId } }),
        ]);
        return { status: "awaiting_budget" as const };
      }
      throw error;
    }
    await db.ragIndexBatchCheckpoint.update({ data: { attempts: { increment: 1 }, errorCode: null, status: "running" }, where: { id: checkpoint.id } });
    await db.document.update({ data: { ragStatus: "embedding" }, where: { id: payload.documentId } });
    const embeddings = await provider.embedTexts(batch.map((chunk) => chunk.embeddingText ?? chunk.text));
    await db.$transaction(async (tx) => {
      for (const [index, chunk] of batch.entries()) {
        const embedding = embeddings[index];
        if (!embedding) throw new Error("missing_embedding_for_chunk");
        await tx.ragChunk.upsert({
          create: toChunkCreate(chunk),
          update: { contentHash: chunk.contentHash, headingPath: chunk.headingPath, pageEnd: chunk.pageEnd, pageStart: chunk.pageStart, sourcePageNumbers: chunk.sourcePageNumbers, text: chunk.text, tokenCount: chunk.tokenCount },
          where: { id: chunk.id },
        });
        await tx.$executeRaw`
          INSERT INTO "RagEmbedding" ("id", "workspaceId", "chunkId", "model", "dimensions", "tokenCount", "embedding", "createdAt")
          VALUES (${randomUUID()}, ${payload.workspaceId}, ${chunk.id}, ${provider.model}, ${embedding.length}, ${chunk.tokenCount}, ${vectorLiteral(embedding)}::vector, NOW())
          ON CONFLICT ("chunkId") DO NOTHING
        `;
      }
      await tx.ragIndexBatchCheckpoint.update({ data: { completedAt: new Date(), errorCode: null, status: "completed" }, where: { id: checkpoint.id } });
    });
  }

  await db.$transaction(async (tx) => {
    await tx.ragChunk.updateMany({ data: { isActive: false }, where: { documentId: payload.documentId, sourceType: "raw_extraction", workspaceId: payload.workspaceId } });
    await tx.ragChunk.updateMany({ data: { isActive: true }, where: { documentId: payload.documentId, indexJobId: payload.indexJobId, workspaceId: payload.workspaceId } });
    await tx.ragIndexJob.update({ data: { completedAt: new Date(), errorCode: null, errorMessage: null, status: "completed" }, where: { id: payload.indexJobId } });
    await tx.document.update({ data: { ragIndexVersion: payload.indexVersion, ragStatus: "indexed" }, where: { id: payload.documentId } });
  });
  return { status: "completed" as const };
}

export function packEmbeddingBatches(chunks: RagChunkRecord[]) {
  const batches: RagChunkRecord[][] = [];
  let current: RagChunkRecord[] = [];
  let tokens = 0;
  for (const chunk of chunks) {
    if (current.length && (current.length >= MAX_EMBEDDING_BATCH_CHUNKS || tokens + chunk.tokenCount > MAX_EMBEDDING_BATCH_TOKENS)) {
      batches.push(current); current = []; tokens = 0;
    }
    current.push(chunk); tokens += chunk.tokenCount;
  }
  if (current.length) batches.push(current);
  return batches;
}

function toChunkCreate(chunk: RagChunkRecord): Prisma.RagChunkUncheckedCreateInput {
  return {
    chunkOrdinal: chunk.chunkOrdinal, chunkingStrategyId: chunk.chunkingStrategyId ?? "paragraph-context-v2",
    contentHash: chunk.contentHash, documentId: chunk.documentId, headingPath: chunk.headingPath,
    id: chunk.id, indexJobId: chunk.indexJobId, indexVersion: chunk.indexVersion, isActive: false,
    pageEnd: chunk.pageEnd, pageStart: chunk.pageStart, reviewStatus: chunk.reviewStatus,
    sourcePageNumbers: chunk.sourcePageNumbers, sourceTopicId: chunk.sourceTopicId ?? null,
    sourceType: chunk.sourceType ?? "raw_extraction", text: chunk.text, tokenCount: chunk.tokenCount,
    workspaceId: chunk.workspaceId,
  };
}

function vectorLiteral(values: number[]) { return `[${values.join(",")}]`; }

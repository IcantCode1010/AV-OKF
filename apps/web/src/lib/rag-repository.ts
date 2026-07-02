import { randomUUID } from "node:crypto";

import type { Prisma } from "@prisma/client";

import { getPrisma } from "./prisma.ts";
import {
  assertEmbeddingBudget,
  type EmbeddingBudgetCaps,
} from "./rag-budget.ts";
import type { ExtractedPageRecord } from "./document-vault.ts";
import type { RagChunkRecord, RetrievalResult } from "./rag-types.ts";

type PrismaLike = ReturnType<typeof getPrisma>;

export type RagRepository = ReturnType<typeof createRagRepository>;

export function createRagRepository(prisma: PrismaLike = getPrisma()) {
  const db = prisma;

  return {
    async createIndexJob(input: {
      documentId: string;
      extractionJobId?: string;
      workspaceId: string;
    }) {
      const document = await db.document.findFirst({
        select: { ragIndexVersion: true },
        where: { id: input.documentId, workspaceId: input.workspaceId },
      });

      if (!document) {
        throw new Error("document_not_found");
      }

      const indexVersion = document.ragIndexVersion + 1;
      const job = await db.ragIndexJob.create({
        data: {
          documentId: input.documentId,
          extractionJobId: input.extractionJobId,
          indexVersion,
          status: "queued",
          workspaceId: input.workspaceId,
        },
      });

      await db.document.update({
        data: { ragStatus: "queued" },
        where: { id: input.documentId },
      });

      return job;
    },

    async failIndexJob(input: {
      documentId: string;
      errorCode: string;
      errorMessage: string;
      indexJobId: string;
    }) {
      await db.ragIndexJob.update({
        data: {
          completedAt: new Date(),
          errorCode: input.errorCode,
          errorMessage: input.errorMessage,
          status: "failed",
        },
        where: { id: input.indexJobId },
      });
      await db.document.update({
        data: { ragStatus: "index_failed" },
        where: { id: input.documentId },
      });
    },

    async getExtractedPages(input: { documentId: string; workspaceId: string }) {
      const pages = await db.extractedPage.findMany({
        orderBy: { pageNumber: "asc" },
        where: { documentId: input.documentId, workspaceId: input.workspaceId },
      });

      return pages.map(mapExtractedPageRecord);
    },

    async getQueuedIndexJobs(limit = 100) {
      return db.ragIndexJob.findMany({
        orderBy: { queuedAt: "asc" },
        take: limit,
        where: { status: { in: ["queued", "running"] } },
      });
    },

    async getTokenUsageToday(input: { workspaceId: string }) {
      return getReservedTokenUsageToday(db, input.workspaceId);
    },

    async markIndexJobRunning(input: {
      indexJobId: string;
      tokenEstimate: number;
    }) {
      await db.ragIndexJob.update({
        data: {
          attempts: { increment: 1 },
          startedAt: new Date(),
          status: "running",
          tokenEstimate: input.tokenEstimate,
        },
        where: { id: input.indexJobId },
      });
    },

    async reserveIndexJobBudget(input: {
      caps?: EmbeddingBudgetCaps;
      indexJobId: string;
      tokenEstimate: number;
      workspaceId: string;
    }) {
      await db.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(2147483000, 0)`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(2147483001, hashtext(${input.workspaceId}))`;

        const usage = await getReservedTokenUsageToday(tx, input.workspaceId);

        assertEmbeddingBudget(
          {
            documentTokenEstimate: input.tokenEstimate,
            globalTokensUsedToday: usage.globalTokensUsedToday,
            workspaceTokensUsedToday: usage.workspaceTokensUsedToday,
          },
          input.caps,
        );

        await tx.ragIndexJob.update({
          data: {
            attempts: { increment: 1 },
            startedAt: new Date(),
            status: "running",
            tokenEstimate: input.tokenEstimate,
          },
          where: { id: input.indexJobId },
        });
      });
    },

    async searchKeyword(input: {
      documentIds?: string[];
      query: string;
      topK: number;
      workspaceId: string;
    }): Promise<RetrievalResult[]> {
      const documentIds = normalizeDocumentIds(input.documentIds);
      const rows = await db.ragChunk.findMany({
        include: { document: true },
        orderBy: [
          { documentId: "asc" },
          { pageStart: "asc" },
          { chunkOrdinal: "asc" },
        ],
        take: input.topK,
        where: {
          ...(documentIds.length > 0
            ? { documentId: { in: documentIds } }
            : {}),
          isActive: true,
          text: { contains: input.query, mode: "insensitive" },
          workspaceId: input.workspaceId,
        },
      });

      return rows.map((row, index) => ({
        chunkId: row.id,
        coveredByOkfConceptIds: [],
        documentId: row.documentId,
        documentTitle: row.document.title,
        pageEnd: row.pageEnd,
        pageStart: row.pageStart,
        retrievalMode: "keyword",
        reviewStatus: row.reviewStatus,
        score: 1 / (index + 1),
        sourcePageNumbers: row.sourcePageNumbers,
        text: row.text,
      }));
    },

    async searchVector(input: {
      documentIds?: string[];
      embedding: number[];
      query: string;
      topK: number;
      workspaceId: string;
    }): Promise<RetrievalResult[]> {
      void input.query;
      const documentIds = normalizeDocumentIds(input.documentIds);
      const hasDocumentFilter = documentIds.length > 0;
      const rows = await db.$queryRaw<
        Array<{
          chunkId: string;
          documentId: string;
          documentTitle: string;
          pageEnd: number;
          pageStart: number;
          reviewStatus: string;
          score: number;
          sourcePageNumbers: number[];
          text: string;
        }>
      >`
        SELECT
          c."id" AS "chunkId",
          c."documentId" AS "documentId",
          d."title" AS "documentTitle",
          c."pageEnd" AS "pageEnd",
          c."pageStart" AS "pageStart",
          c."reviewStatus" AS "reviewStatus",
          1 - (e."embedding" <=> ${vectorLiteral(input.embedding)}::vector) AS "score",
          c."sourcePageNumbers" AS "sourcePageNumbers",
          c."text" AS "text"
        FROM "RagEmbedding" e
        INNER JOIN "RagChunk" c ON c."id" = e."chunkId"
        INNER JOIN "Document" d ON d."id" = c."documentId"
        WHERE c."workspaceId" = ${input.workspaceId}
          AND c."isActive" = true
          AND (${hasDocumentFilter} = false OR c."documentId" = ANY(${documentIds}::text[]))
        ORDER BY e."embedding" <=> ${vectorLiteral(input.embedding)}::vector ASC
        LIMIT ${input.topK}
      `;

      return rows.map((row) => ({
        chunkId: row.chunkId,
        coveredByOkfConceptIds: [],
        documentId: row.documentId,
        documentTitle: row.documentTitle,
        pageEnd: row.pageEnd,
        pageStart: row.pageStart,
        retrievalMode: "vector",
        reviewStatus: row.reviewStatus,
        score: row.score,
        sourcePageNumbers: row.sourcePageNumbers,
        text: row.text,
      }));
    },

    async storeCompletedIndex(input: {
      chunks: RagChunkRecord[];
      documentId: string;
      embeddings: number[][];
      indexJobId: string;
      indexVersion: number;
      model: string;
      workspaceId: string;
    }) {
      await db.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.ragChunk.updateMany({
          data: { isActive: false },
          where: { documentId: input.documentId, workspaceId: input.workspaceId },
        });

        for (const [index, chunk] of input.chunks.entries()) {
          const embedding = input.embeddings[index];

          if (!embedding) {
            throw new Error("missing_embedding_for_chunk");
          }

          await tx.ragChunk.create({
            data: {
              chunkOrdinal: chunk.chunkOrdinal,
              contentHash: chunk.contentHash,
              documentId: chunk.documentId,
              headingPath: chunk.headingPath,
              id: chunk.id,
              indexJobId: chunk.indexJobId,
              indexVersion: chunk.indexVersion,
              isActive: true,
              pageEnd: chunk.pageEnd,
              pageStart: chunk.pageStart,
              reviewStatus: chunk.reviewStatus,
              sourcePageNumbers: chunk.sourcePageNumbers,
              text: chunk.text,
              tokenCount: chunk.tokenCount,
              workspaceId: chunk.workspaceId,
            },
          });

          await tx.$executeRaw`
            INSERT INTO "RagEmbedding" (
              "id",
              "workspaceId",
              "chunkId",
              "model",
              "dimensions",
              "tokenCount",
              "embedding",
              "createdAt"
            )
            VALUES (
              ${randomUUID()},
              ${input.workspaceId},
              ${chunk.id},
              ${input.model},
              ${embedding.length},
              ${chunk.tokenCount},
              ${vectorLiteral(embedding)}::vector,
              NOW()
            )
          `;
        }

        await tx.ragIndexJob.update({
          data: { completedAt: new Date(), status: "completed" },
          where: { id: input.indexJobId },
        });
        await tx.document.update({
          data: {
            ragIndexVersion: input.indexVersion,
            ragStatus: "indexed",
          },
          where: { id: input.documentId },
        });
      });
    },
  };
}

async function getReservedTokenUsageToday(
  db: Prisma.TransactionClient | PrismaLike,
  workspaceId: string,
) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const usageWindow: Prisma.RagIndexJobWhereInput = {
    OR: [
      { completedAt: { gte: start }, status: "completed" },
      { startedAt: { gte: start }, status: "running" },
    ],
    tokenEstimate: { gt: 0 },
  };

  const [workspace, global] = await Promise.all([
    db.ragIndexJob.aggregate({
      _sum: { tokenEstimate: true },
      where: {
        ...usageWindow,
        workspaceId,
      },
    }),
    db.ragIndexJob.aggregate({
      _sum: { tokenEstimate: true },
      where: usageWindow,
    }),
  ]);

  return {
    globalTokensUsedToday: global._sum.tokenEstimate ?? 0,
    workspaceTokensUsedToday: workspace._sum.tokenEstimate ?? 0,
  };
}

function mapExtractedPageRecord(page: {
  charCount: number;
  imageCount: number;
  pageNumber: number;
  tables: unknown;
  text: string;
}): ExtractedPageRecord {
  return {
    charCount: page.charCount,
    imageCount: page.imageCount,
    pageNumber: page.pageNumber,
    tables: normalizeExtractedTables(page.tables),
    text: page.text,
  };
}

function normalizeExtractedTables(value: unknown): ExtractedPageRecord["tables"] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isExtractedTable);
}

function isExtractedTable(
  value: unknown,
): value is ExtractedPageRecord["tables"][number] {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as { index?: unknown; rows?: unknown };
  return (
    typeof candidate.index === "number" &&
    Array.isArray(candidate.rows) &&
    candidate.rows.every(
      (row) =>
        Array.isArray(row) &&
        row.every((cell) => typeof cell === "string"),
    )
  );
}

function vectorLiteral(embedding: number[]) {
  return `[${embedding.join(",")}]`;
}

function normalizeDocumentIds(documentIds?: string[]) {
  return documentIds?.filter((documentId) => documentId.trim().length > 0) ?? [];
}

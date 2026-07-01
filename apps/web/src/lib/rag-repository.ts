import { randomUUID } from "node:crypto";

import type { Prisma } from "@prisma/client";

import { getPrisma } from "./prisma.ts";
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
      const start = new Date();
      start.setHours(0, 0, 0, 0);

      const [workspace, global] = await Promise.all([
        db.ragIndexJob.aggregate({
          _sum: { tokenEstimate: true },
          where: {
            completedAt: { gte: start },
            status: "completed",
            workspaceId: input.workspaceId,
          },
        }),
        db.ragIndexJob.aggregate({
          _sum: { tokenEstimate: true },
          where: {
            completedAt: { gte: start },
            status: "completed",
          },
        }),
      ]);

      return {
        globalTokensUsedToday: global._sum.tokenEstimate ?? 0,
        workspaceTokensUsedToday: workspace._sum.tokenEstimate ?? 0,
      };
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

    async searchKeyword(input: {
      query: string;
      topK: number;
      workspaceId: string;
    }): Promise<RetrievalResult[]> {
      const rows = await db.ragChunk.findMany({
        include: { document: true },
        take: input.topK,
        where: {
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
        score: 1 / (index + 1),
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

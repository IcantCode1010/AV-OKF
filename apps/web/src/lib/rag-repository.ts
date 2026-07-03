import { randomUUID } from "node:crypto";

import type { Prisma } from "@prisma/client";

import { getPrisma } from "./prisma.ts";
import {
  assertEmbeddingBudget,
  type EmbeddingBudgetCaps,
} from "./rag-budget.ts";
import type { ExtractedPageRecord } from "./document-vault.ts";
import {
  RAG_REINDEX_IN_FLIGHT_STATUSES,
  type RagChunkRecord,
  type ReindexDocumentRow,
  type RetrievalResult,
} from "./rag-types.ts";

const RAW_EXTRACTION_SOURCE_TYPE = "raw_extraction";
const OKF_TOPIC_SOURCE_TYPE = "okf_topic";

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

    async createReindexJob(input: {
      chunkingStrategyId: string;
      documentId: string;
      workspaceId: string;
    }) {
      return db.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(2147483002, hashtext(${input.workspaceId}))`;

        const document = await tx.document.findFirst({
          select: { ragIndexVersion: true },
          where: { id: input.documentId, workspaceId: input.workspaceId },
        });

        if (!document) {
          throw new Error("document_not_found");
        }

        const activeDocument = await tx.document.findFirst({
          select: { id: true },
          where: {
            ragStatus: { in: [...RAG_REINDEX_IN_FLIGHT_STATUSES] },
            workspaceId: input.workspaceId,
          },
        });

        if (activeDocument) {
          throw new Error(`reindex_already_running:${activeDocument.id}`);
        }

        const indexVersion = document.ragIndexVersion + 1;
        const job = await tx.ragIndexJob.create({
          data: {
            documentId: input.documentId,
            extractionJobId: null,
            indexVersion,
            status: "queued",
            workspaceId: input.workspaceId,
          },
        });

        await tx.document.update({
          data: { ragStatus: "queued" },
          where: { id: input.documentId },
        });

        return job;
      });
    },

    async deleteChunksForDocument(input: {
      documentId: string;
      workspaceId: string;
    }) {
      await db.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.ragEmbedding.deleteMany({
          where: {
            chunk: {
              documentId: input.documentId,
              sourceType: RAW_EXTRACTION_SOURCE_TYPE,
              workspaceId: input.workspaceId,
            },
          },
        });
        await tx.ragChunk.deleteMany({
          where: {
            documentId: input.documentId,
            sourceType: RAW_EXTRACTION_SOURCE_TYPE,
            workspaceId: input.workspaceId,
          },
        });
      });
    },

    async deleteOkfSyncedChunks(input: {
      documentId: string;
      sourceTopicId?: string;
      workspaceId: string;
    }) {
      await db.$transaction(async (tx: Prisma.TransactionClient) => {
        const chunkWhere: Prisma.RagChunkWhereInput = {
          documentId: input.documentId,
          sourceType: OKF_TOPIC_SOURCE_TYPE,
          ...(input.sourceTopicId ? { sourceTopicId: input.sourceTopicId } : {}),
          workspaceId: input.workspaceId,
        };

        await tx.ragEmbedding.deleteMany({
          where: { chunk: chunkWhere },
        });
        await tx.ragChunk.deleteMany({
          where: chunkWhere,
        });
      });
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
        data: { ragStatus: "failed" },
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

    async listReindexDocuments(input: {
      workspaceId: string;
    }): Promise<ReindexDocumentRow[]> {
      const documents = await db.document.findMany({
        include: {
          ragChunks: {
            orderBy: [{ indexVersion: "desc" }, { chunkOrdinal: "asc" }],
            select: {
              chunkingStrategyId: true,
              createdAt: true,
              id: true,
              isActive: true,
            },
            where: { isActive: true, sourceType: RAW_EXTRACTION_SOURCE_TYPE },
          },
          ragIndexJobs: {
            orderBy: [{ completedAt: "desc" }, { queuedAt: "desc" }],
            select: {
              completedAt: true,
              errorCode: true,
              errorMessage: true,
              status: true,
            },
            take: 1,
          },
        },
        orderBy: { updatedAt: "desc" },
        where: { workspaceId: input.workspaceId },
      });

      return documents.map((document) => {
        const latestJob = document.ragIndexJobs[0];
        const latestChunk = document.ragChunks[0];
        const latestChunkDate = document.ragChunks.reduce<Date | null>(
          (latest, chunk) =>
            latest && latest > chunk.createdAt ? latest : chunk.createdAt,
          null,
        );

        return {
          chunkCount: document.ragChunks.length,
          chunkingStrategyId: latestChunk?.chunkingStrategyId ?? null,
          id: document.id,
          lastIndexedAt: latestJob?.completedAt ?? latestChunkDate,
          latestError:
            latestJob?.status === "failed"
              ? latestJob.errorMessage ?? latestJob.errorCode
              : null,
          ragStatus: document.ragStatus,
          sizeBytes: document.sizeBytes,
          sizeLabel: document.size,
          title: document.title,
        };
      });
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
      const job = await db.ragIndexJob.findUnique({
        select: { documentId: true },
        where: { id: input.indexJobId },
      });
      if (job) {
        await db.document.update({
          data: { ragStatus: "chunking" },
          where: { id: job.documentId },
        });
      }
    },

    async markDocumentRagStatus(input: {
      documentId: string;
      status: string;
      workspaceId: string;
    }) {
      await db.document.updateMany({
        data: { ragStatus: input.status },
        where: { id: input.documentId, workspaceId: input.workspaceId },
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
      const coverage = await getCoverageByChunkId(db, {
        chunkIds: rows.map((row) => row.id),
        workspaceId: input.workspaceId,
      });

      return rows.map((row, index) => ({
        chunkId: row.id,
        coveredByOkfConceptIds: coverage.get(row.id) ?? [],
        documentId: row.documentId,
        documentTitle: row.document.title,
        pageEnd: row.pageEnd,
        pageStart: row.pageStart,
        retrievalMode: "keyword",
        reviewStatus: row.reviewStatus,
        score: 1 / (index + 1),
        sourcePageNumbers: row.sourcePageNumbers,
        sourceType: row.sourceType,
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
          sourceType: string;
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
          c."sourceType" AS "sourceType",
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
      const coverage = await getCoverageByChunkId(db, {
        chunkIds: rows.map((row) => row.chunkId),
        workspaceId: input.workspaceId,
      });

      return rows.map((row) => ({
        chunkId: row.chunkId,
        coveredByOkfConceptIds: coverage.get(row.chunkId) ?? [],
        documentId: row.documentId,
        documentTitle: row.documentTitle,
        pageEnd: row.pageEnd,
        pageStart: row.pageStart,
        retrievalMode: "vector",
        reviewStatus: row.reviewStatus,
        score: row.score,
        sourcePageNumbers: row.sourcePageNumbers,
        sourceType: row.sourceType,
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
          where: {
            documentId: input.documentId,
            sourceType: RAW_EXTRACTION_SOURCE_TYPE,
            workspaceId: input.workspaceId,
          },
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
              chunkingStrategyId: chunk.chunkingStrategyId ?? null,
              isActive: true,
              pageEnd: chunk.pageEnd,
              pageStart: chunk.pageStart,
              reviewStatus: chunk.reviewStatus,
              sourcePageNumbers: chunk.sourcePageNumbers,
              sourceTopicId: chunk.sourceTopicId ?? null,
              sourceType: chunk.sourceType ?? RAW_EXTRACTION_SOURCE_TYPE,
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

    async listApprovedTopicsForRagSync(input: { workspaceId: string }) {
      return db.topicRecord.findMany({
        orderBy: [{ documentId: "asc" }, { updatedAt: "asc" }],
        select: {
          approvedContentSource: true,
          documentId: true,
          enrichedSummary: true,
          enrichedTitle: true,
          id: true,
          originalSummary: true,
          originalTitle: true,
          pageEnd: true,
          pageStart: true,
          sourcePageNumbers: true,
          summary: true,
          title: true,
          workspaceId: true,
        },
        where: {
          reviewStatus: "approved",
          workspaceId: input.workspaceId,
        },
      });
    },

    async getOkfSyncedChunksForTopics(input: {
      sourceTopicIds: string[];
      workspaceId: string;
    }) {
      if (input.sourceTopicIds.length === 0) {
        return [];
      }

      return db.ragChunk.findMany({
        select: {
          contentHash: true,
          documentId: true,
          id: true,
          sourceTopicId: true,
          workspaceId: true,
        },
        where: {
          isActive: true,
          sourceTopicId: { in: input.sourceTopicIds },
          sourceType: OKF_TOPIC_SOURCE_TYPE,
          workspaceId: input.workspaceId,
        },
      });
    },

    async createOkfSyncIndexJob(input: {
      caps?: EmbeddingBudgetCaps;
      documentId: string;
      tokenEstimate: number;
      workspaceId: string;
    }) {
      return db.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(2147483003, hashtext(${input.documentId}))`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(2147483001, hashtext(${input.workspaceId}))`;

        const document = await tx.document.findFirst({
          select: { ragIndexVersion: true },
          where: { id: input.documentId, workspaceId: input.workspaceId },
        });

        if (!document) {
          throw new Error("document_not_found");
        }

        const indexVersion = document.ragIndexVersion + 1;
        const usage = await getReservedTokenUsageToday(tx, input.workspaceId);

        assertEmbeddingBudget(
          {
            documentTokenEstimate: input.tokenEstimate,
            globalTokensUsedToday: usage.globalTokensUsedToday,
            workspaceTokensUsedToday: usage.workspaceTokensUsedToday,
          },
          input.caps,
        );

        await tx.document.update({
          data: { ragIndexVersion: indexVersion },
          where: { id: input.documentId },
        });

        return tx.ragIndexJob.create({
          data: {
            documentId: input.documentId,
            extractionJobId: null,
            indexVersion,
            startedAt: new Date(),
            status: "okf_sync_running",
            tokenEstimate: input.tokenEstimate,
            workspaceId: input.workspaceId,
          },
        });
      });
    },

    async completeOkfSyncJob(input: { indexJobId: string }) {
      await db.ragIndexJob.update({
        data: {
          completedAt: new Date(),
          status: "okf_sync_completed",
        },
        where: { id: input.indexJobId },
      });
    },

    async failOkfSyncJob(input: {
      errorMessage: string;
      indexJobId: string;
    }) {
      await db.ragIndexJob.update({
        data: {
          completedAt: new Date(),
          errorCode: "okf_sync_failed",
          errorMessage: input.errorMessage,
          status: "failed",
        },
        where: { id: input.indexJobId },
      });
    },

    async listActiveChunksForDocument(input: {
      documentId: string;
      workspaceId: string;
    }): Promise<{ id: string; sourcePageNumbers: number[] }[]> {
      // Coverage only resolves against raw extraction chunks: okf_topic chunks
      // (synced separately) carry a topic's own page range and would otherwise
      // let a topic "cover" itself or another approved topic's synced chunk.
      return db.ragChunk.findMany({
        select: { id: true, sourcePageNumbers: true },
        where: {
          documentId: input.documentId,
          isActive: true,
          sourceType: RAW_EXTRACTION_SOURCE_TYPE,
          workspaceId: input.workspaceId,
        },
      });
    },

    async syncOkfConceptChunkLinks(input: {
      chunkIds: string[];
      coverageType: string;
      okfConceptId: string;
      workspaceId: string;
    }) {
      await db.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.okfConceptChunkLink.deleteMany({
          where: {
            okfConceptId: input.okfConceptId,
            workspaceId: input.workspaceId,
            ...(input.chunkIds.length > 0
              ? { chunkId: { notIn: input.chunkIds } }
              : {}),
          },
        });

        if (input.chunkIds.length === 0) {
          return;
        }

        await tx.okfConceptChunkLink.createMany({
          data: input.chunkIds.map((chunkId) => ({
            chunkId,
            coverageType: input.coverageType,
            okfConceptId: input.okfConceptId,
            workspaceId: input.workspaceId,
          })),
          skipDuplicates: true,
        });
      });
    },

    async storeOkfSyncedChunk(input: {
      chunk: RagChunkRecord;
      embedding: number[];
      model: string;
    }) {
      await db.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.ragChunk.create({
          data: {
            chunkOrdinal: input.chunk.chunkOrdinal,
            chunkingStrategyId: input.chunk.chunkingStrategyId ?? null,
            contentHash: input.chunk.contentHash,
            documentId: input.chunk.documentId,
            headingPath: input.chunk.headingPath,
            id: input.chunk.id,
            indexJobId: input.chunk.indexJobId,
            indexVersion: input.chunk.indexVersion,
            isActive: true,
            pageEnd: input.chunk.pageEnd,
            pageStart: input.chunk.pageStart,
            reviewStatus: input.chunk.reviewStatus,
            sourcePageNumbers: input.chunk.sourcePageNumbers,
            sourceTopicId: input.chunk.sourceTopicId ?? null,
            sourceType: input.chunk.sourceType ?? OKF_TOPIC_SOURCE_TYPE,
            text: input.chunk.text,
            tokenCount: input.chunk.tokenCount,
            workspaceId: input.chunk.workspaceId,
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
            ${input.chunk.workspaceId},
            ${input.chunk.id},
            ${input.model},
            ${input.embedding.length},
            ${input.chunk.tokenCount},
            ${vectorLiteral(input.embedding)}::vector,
            NOW()
          )
        `;
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
      {
        completedAt: { gte: start },
        status: { in: ["completed", "okf_sync_completed"] },
      },
      {
        startedAt: { gte: start },
        status: { in: ["running", "okf_sync_running"] },
      },
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

async function getCoverageByChunkId(
  db: PrismaLike,
  input: { chunkIds: string[]; workspaceId: string },
): Promise<Map<string, string[]>> {
  const coverage = new Map<string, string[]>();

  if (input.chunkIds.length === 0) {
    return coverage;
  }

  const links = await db.okfConceptChunkLink.findMany({
    select: { chunkId: true, okfConceptId: true },
    where: { chunkId: { in: input.chunkIds }, workspaceId: input.workspaceId },
  });

  for (const link of links) {
    const existing = coverage.get(link.chunkId);

    if (existing) {
      existing.push(link.okfConceptId);
    } else {
      coverage.set(link.chunkId, [link.okfConceptId]);
    }
  }

  return coverage;
}

function vectorLiteral(embedding: number[]) {
  return `[${embedding.join(",")}]`;
}

function normalizeDocumentIds(documentIds?: string[]) {
  return documentIds?.filter((documentId) => documentId.trim().length > 0) ?? [];
}

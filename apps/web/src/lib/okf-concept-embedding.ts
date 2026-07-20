import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { UnrecoverableError } from "bullmq";
import { Prisma, type PrismaClient } from "@prisma/client";

import { getEmbeddingProvider, type EmbeddingProvider } from "./embedding-provider.ts";
import {
  EmbeddingBudgetExceededError,
  assertEmbeddingBudget,
  getEmbeddingBudgetCaps,
} from "./rag-budget.ts";
import { getTokenCounter } from "./rag-tokenizer.ts";
import { getPrisma } from "./prisma.ts";
import { resolveKnowledgeBundleRoot } from "./knowledge-bundles.ts";
import { resolveKnowledgePath } from "./knowledge-root.ts";
import { isAgentReadyOkfMetadata } from "./okf-generic-metadata.ts";
import { parseOkfMarkdown } from "./okf-frontmatter.ts";
import { getOkfConceptLifecycleForFile } from "./okf-lifecycle.ts";
import {
  buildOkfConceptEmbeddingText,
  hashOkfSource,
} from "./okf-concept-embedding-content.ts";
import {
  getOkfConceptEmbeddingQueue,
  type OkfConceptEmbeddingJobPayload,
  type OkfConceptEmbeddingQueue,
} from "./okf-concept-embedding-queue.ts";

const DEFAULT_OKF_CONCEPT_MAX_TOKENS = 20_000;

type PrismaLike = PrismaClient;

export type OkfSemanticCandidate = {
  contentHash: string;
  filePath: string;
};

export type OkfSemanticMatch = {
  filePath: string;
  score: number;
};

export function createOkfConceptEmbeddingRepository(db: PrismaLike = getPrisma()) {
  return {
    async createOrReuseJob(input: {
      bundleName: string;
      contentHash: string;
      filePath: string;
      knowledgeBundleId: string;
      workspaceId: string;
    }) {
      return db.okfConceptEmbeddingJob.upsert({
        create: {
          bundleName: input.bundleName,
          contentHash: input.contentHash,
          filePath: input.filePath,
          knowledgeBundleId: input.knowledgeBundleId,
          status: "queued",
          workspaceId: input.workspaceId,
        },
        update: {
          bundleName: input.bundleName,
          errorCode: null,
          errorMessage: null,
          status: "queued",
        },
        where: {
          knowledgeBundleId_filePath_contentHash: {
            contentHash: input.contentHash,
            filePath: input.filePath,
            knowledgeBundleId: input.knowledgeBundleId,
          },
        },
      });
    },

    async deleteForFile(input: {
      filePath: string;
      knowledgeBundleId: string;
      workspaceId: string;
    }) {
      await db.$transaction([
        db.okfConceptEmbedding.deleteMany({ where: input }),
        db.okfConceptEmbeddingJob.deleteMany({ where: input }),
      ]);
    },

    async failJob(input: { errorCode: string; errorMessage: string; jobId: string }) {
      await db.okfConceptEmbeddingJob.updateMany({
        data: {
          completedAt: new Date(),
          errorCode: input.errorCode,
          errorMessage: input.errorMessage,
          status: "failed",
        },
        where: { id: input.jobId },
      });
    },

    async getEmbeddingMetadata(input: {
      knowledgeBundleId: string;
      workspaceId: string;
    }) {
      return db.okfConceptEmbedding.findMany({
        select: { contentHash: true, filePath: true },
        where: {
          knowledgeBundleId: input.knowledgeBundleId,
          workspaceId: input.workspaceId,
        },
      });
    },

    async getQueuedJobs(limit = 500) {
      return db.okfConceptEmbeddingJob.findMany({
        orderBy: { queuedAt: "asc" },
        take: limit,
        where: { status: { in: ["queued", "running"] } },
      });
    },

    async reserveBudget(input: { jobId: string; tokenEstimate: number; workspaceId: string }) {
      await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(2147483000, 0)`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(2147483001, hashtext(${input.workspaceId}))`;
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const [ragWorkspace, ragGlobal, okfWorkspace, okfGlobal] = await Promise.all([
          tx.ragIndexJob.aggregate({ _sum: { tokenEstimate: true }, where: embeddingUsageWindow(start, input.workspaceId) }),
          tx.ragIndexJob.aggregate({ _sum: { tokenEstimate: true }, where: embeddingUsageWindow(start) }),
          tx.okfConceptEmbeddingJob.aggregate({ _sum: { tokenEstimate: true }, where: okfUsageWindow(start, input.workspaceId) }),
          tx.okfConceptEmbeddingJob.aggregate({ _sum: { tokenEstimate: true }, where: okfUsageWindow(start) }),
        ]);
        const caps = getEmbeddingBudgetCaps();
        assertEmbeddingBudget({
          documentTokenEstimate: input.tokenEstimate,
          globalTokensUsedToday: (ragGlobal._sum.tokenEstimate ?? 0) + (okfGlobal._sum.tokenEstimate ?? 0),
          workspaceTokensUsedToday: (ragWorkspace._sum.tokenEstimate ?? 0) + (okfWorkspace._sum.tokenEstimate ?? 0),
        }, { ...caps, tokensPerDocument: getOkfConceptMaxTokens() });
        await tx.okfConceptEmbeddingJob.update({
          data: {
            attempts: { increment: 1 },
            startedAt: new Date(),
            status: "running",
            tokenEstimate: input.tokenEstimate,
          },
          where: { id: input.jobId },
        });
      });
    },

    async search(input: {
      candidates: OkfSemanticCandidate[];
      embedding: number[];
      knowledgeBundleId: string;
      topK: number;
      workspaceId: string;
    }): Promise<OkfSemanticMatch[]> {
      if (input.candidates.length === 0) return [];
      const eligible = Prisma.join(
        input.candidates.map((candidate) => Prisma.sql`(e."filePath" = ${candidate.filePath} AND e."contentHash" = ${candidate.contentHash})`),
        " OR ",
      );
      return db.$queryRaw<OkfSemanticMatch[]>(Prisma.sql`
        SELECT e."filePath" AS "filePath",
          1 - (e."embedding" <=> ${vectorLiteral(input.embedding)}::vector) AS "score"
        FROM "OkfConceptEmbedding" e
        WHERE e."workspaceId" = ${input.workspaceId}
          AND e."knowledgeBundleId" = ${input.knowledgeBundleId}
          AND (${eligible})
        ORDER BY e."embedding" <=> ${vectorLiteral(input.embedding)}::vector ASC,
          e."filePath" ASC
        LIMIT ${input.topK}
      `);
    },

    async storeCompleted(input: {
      contentHash: string;
      dimensions: number;
      embedding: number[];
      filePath: string;
      jobId: string;
      knowledgeBundleId: string;
      model: string;
      tokenCount: number;
      workspaceId: string;
    }) {
      await db.$transaction(async (tx) => {
        await tx.$executeRaw`
          INSERT INTO "OkfConceptEmbedding" (
            "id", "workspaceId", "knowledgeBundleId", "filePath", "contentHash",
            "model", "dimensions", "tokenCount", "embedding", "createdAt", "updatedAt"
          ) VALUES (
            ${randomUUID()}, ${input.workspaceId}, ${input.knowledgeBundleId}, ${input.filePath},
            ${input.contentHash}, ${input.model}, ${input.dimensions}, ${input.tokenCount},
            ${vectorLiteral(input.embedding)}::vector, NOW(), NOW()
          )
          ON CONFLICT ("knowledgeBundleId", "filePath") DO UPDATE SET
            "contentHash" = EXCLUDED."contentHash", "model" = EXCLUDED."model",
            "dimensions" = EXCLUDED."dimensions", "tokenCount" = EXCLUDED."tokenCount",
            "embedding" = EXCLUDED."embedding", "updatedAt" = NOW()
        `;
        await tx.okfConceptEmbeddingJob.update({
          data: { completedAt: new Date(), status: "completed" },
          where: { id: input.jobId },
        });
      });
    },
  };
}

export async function queueOkfConceptEmbedding(input: {
  bundleName: string;
  filePath: string;
  knowledgeBundleId: string;
  markdown: string;
  queue?: OkfConceptEmbeddingQueue;
  repository?: ReturnType<typeof createOkfConceptEmbeddingRepository>;
  workspaceId: string;
}) {
  if (process.env.AV_OKF_BACKEND !== "production") return;
  const contentHash = hashOkfSource(input.markdown);
  return queueOkfConceptEmbeddingByHash({ ...input, contentHash });
}

export async function queueOkfConceptEmbeddingByHash(input: {
  bundleName: string;
  contentHash: string;
  filePath: string;
  knowledgeBundleId: string;
  queue?: OkfConceptEmbeddingQueue;
  repository?: ReturnType<typeof createOkfConceptEmbeddingRepository>;
  workspaceId: string;
}) {
  if (process.env.AV_OKF_BACKEND !== "production") return;
  const repository = input.repository ?? createOkfConceptEmbeddingRepository();
  const { contentHash } = input;
  const job = await repository.createOrReuseJob({ ...input, contentHash });
  try {
    await (input.queue ?? getOkfConceptEmbeddingQueue()).enqueue({
      contentHash,
      filePath: input.filePath,
      jobId: job.id,
      knowledgeBundleId: input.knowledgeBundleId,
      workspaceId: input.workspaceId,
    });
  } catch (error) {
    console.error("okf_concept_embedding_enqueue_failed", error);
  }
}

export async function runOkfConceptEmbeddingJob(
  payload: OkfConceptEmbeddingJobPayload,
  options: {
    embeddingProvider?: EmbeddingProvider;
    repository?: ReturnType<typeof createOkfConceptEmbeddingRepository>;
  } = {},
) {
  const repository = options.repository ?? createOkfConceptEmbeddingRepository();
  try {
    const db = getPrisma();
    const bundle = await db.knowledgeBundle.findFirst({
      select: { name: true },
      where: { id: payload.knowledgeBundleId, status: "active", workspaceId: payload.workspaceId },
    });
    if (!bundle) throw new Error("knowledge_bundle_not_found");
    const root = resolveKnowledgeBundleRoot({ bundleId: payload.knowledgeBundleId, workspaceId: payload.workspaceId });
    const fullPath = await resolveKnowledgePath({ knowledgeRoot: root, relativePath: payload.filePath });
    if (!fullPath) throw new Error("okf_embedding_source_missing");
    const markdown = await readFile(fullPath, "utf8");
    const lifecycle = await getOkfConceptLifecycleForFile({
      filePath: payload.filePath,
      knowledgeBundleId: payload.knowledgeBundleId,
      workspaceId: payload.workspaceId,
    });
    const parsed = parseOkfMarkdown(markdown);
    const contentHash = hashOkfSource(markdown);
    if (contentHash !== payload.contentHash || lifecycle.status !== "active" || !isAgentReadyOkfMetadata(parsed.frontmatter, parsed.body)) {
      await repository.deleteForFile({
        filePath: payload.filePath,
        knowledgeBundleId: payload.knowledgeBundleId,
        workspaceId: payload.workspaceId,
      });
      return;
    }
    const text = buildOkfConceptEmbeddingText({ bundleName: bundle.name, markdown });
    const tokenCount = getTokenCounter().count(text);
    await repository.reserveBudget({ jobId: payload.jobId, tokenEstimate: tokenCount, workspaceId: payload.workspaceId });
    const provider = options.embeddingProvider ?? getEmbeddingProvider();
    const [embedding] = await provider.embedTexts([text]);
    if (!embedding) throw new Error("okf_embedding_provider_returned_empty");
    await repository.storeCompleted({
      ...payload,
      contentHash,
      dimensions: provider.dimensions,
      embedding,
      model: provider.model,
      tokenCount,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const budget = error instanceof EmbeddingBudgetExceededError;
    await repository.failJob({
      errorCode: budget ? "embedding_budget_exceeded" : "okf_embedding_failed",
      errorMessage: message,
      jobId: payload.jobId,
    });
    if (budget) throw new UnrecoverableError(message);
    throw error;
  }
}

export async function reconcileOkfConceptEmbeddings(options: {
  queue?: OkfConceptEmbeddingQueue;
  repository?: ReturnType<typeof createOkfConceptEmbeddingRepository>;
} = {}) {
  const db = getPrisma();
  const repository = options.repository ?? createOkfConceptEmbeddingRepository();
  const queue = options.queue ?? getOkfConceptEmbeddingQueue();
  const bundles = await db.knowledgeBundle.findMany({
    select: { id: true, name: true, workspaceId: true },
    where: { status: "active" },
  });
  const { listApprovedOkfBundleEvidence } = await import("./okf-bundle-retriever.ts");

  for (const bundle of bundles) {
    const knowledgeRoot = resolveKnowledgeBundleRoot({
      bundleId: bundle.id,
      workspaceId: bundle.workspaceId,
    });
    const concepts = await listApprovedOkfBundleEvidence({
      knowledgeBundleId: bundle.id,
      knowledgeRoot,
      lifecycleLookup: async (input) => getOkfConceptLifecycleForFile(input),
      workspaceId: bundle.workspaceId,
    });
    const metadata = await repository.getEmbeddingMetadata({
      knowledgeBundleId: bundle.id,
      workspaceId: bundle.workspaceId,
    });
    const current = new Set(metadata.map((row) => `${row.filePath}:${row.contentHash}`));
    for (const concept of concepts) {
      if (!concept.contentHash || current.has(`${concept.filePath}:${concept.contentHash}`)) continue;
      await queueOkfConceptEmbeddingByHash({
        bundleName: bundle.name,
        contentHash: concept.contentHash,
        filePath: concept.filePath,
        knowledgeBundleId: bundle.id,
        queue,
        repository,
        workspaceId: bundle.workspaceId,
      });
    }
  }

  const queued = await repository.getQueuedJobs();
  for (const job of queued) {
    await queue.enqueue({
      contentHash: job.contentHash,
      filePath: job.filePath,
      jobId: job.id,
      knowledgeBundleId: job.knowledgeBundleId,
      workspaceId: job.workspaceId,
    });
  }
}

function embeddingUsageWindow(start: Date, workspaceId?: string): Prisma.RagIndexJobWhereInput {
  return {
    OR: [
      { completedAt: { gte: start }, status: { in: ["completed", "okf_sync_completed"] } },
      { startedAt: { gte: start }, status: { in: ["running", "okf_sync_running"] } },
    ],
    tokenEstimate: { gt: 0 },
    ...(workspaceId ? { workspaceId } : {}),
  };
}

function okfUsageWindow(start: Date, workspaceId?: string): Prisma.OkfConceptEmbeddingJobWhereInput {
  return {
    OR: [
      { completedAt: { gte: start }, status: "completed" },
      { startedAt: { gte: start }, status: "running" },
    ],
    tokenEstimate: { gt: 0 },
    ...(workspaceId ? { workspaceId } : {}),
  };
}

function vectorLiteral(embedding: number[]) {
  return `[${embedding.join(",")}]`;
}

function getOkfConceptMaxTokens() {
  const value = Number(
    process.env.OKF_EMBEDDING_MAX_TOKENS_PER_CONCEPT ?? DEFAULT_OKF_CONCEPT_MAX_TOKENS,
  );
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("invalid_env_OKF_EMBEDDING_MAX_TOKENS_PER_CONCEPT");
  }
  return value;
}

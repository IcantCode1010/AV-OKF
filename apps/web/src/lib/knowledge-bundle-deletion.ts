import { rm } from "node:fs/promises";

import { Prisma } from "@prisma/client";
import { Queue } from "bullmq";

import type { AuthWorkspaceContext } from "./auth-workspace.ts";
import { getPrisma } from "./prisma.ts";
import { resolveKnowledgeBundleRoot, writeWorkspaceVault } from "./knowledge-bundles.ts";

export type KnowledgeBundleDeletionJobPayload = {
  jobId: string;
};

export type KnowledgeBundleDeletionManifest = {
  bundleId: string;
  bundleName: string;
  documentIds: string[];
  documentTitles: string[];
  requestedAt: string;
  workspaceId: string;
};

export type KnowledgeBundleDeletionStatus = {
  bundleId: string;
  bundleName: string;
  completedAt: string | null;
  documentCount: number;
  errorCode: string | null;
  errorMessage: string | null;
  id: string;
  status: string;
};

export type KnowledgeBundleDeletionStatusSnapshot = {
  active: boolean;
  fingerprint: string;
  jobs: KnowledgeBundleDeletionStatus[];
};

type EnqueueDeletion = (payload: KnowledgeBundleDeletionJobPayload) => Promise<void>;

let cachedQueue: Queue<KnowledgeBundleDeletionJobPayload> | null = null;

export function getKnowledgeBundleDeletionQueue() {
  if (!cachedQueue) {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) throw new Error("missing_env_REDIS_URL");
    cachedQueue = new Queue<KnowledgeBundleDeletionJobPayload>("knowledge-bundle-deletion", {
      connection: { url: redisUrl },
    });
  }
  return cachedQueue;
}

export async function enqueueKnowledgeBundleDeletionJob(
  payload: KnowledgeBundleDeletionJobPayload,
) {
  await getKnowledgeBundleDeletionQueue().add("delete-bundle", payload, {
    attempts: 5,
    backoff: { delay: 2_000, type: "exponential" },
    jobId: `delete-bundle-${payload.jobId}`,
    removeOnComplete: true,
    removeOnFail: false,
  });
}

export async function requestKnowledgeBundleDeletion(input: {
  actorId: string;
  bundleId: string;
  db?: ReturnType<typeof getPrisma>;
  enqueue?: EnqueueDeletion;
  workspaceId: string;
}) {
  if (process.env.AV_OKF_BACKEND !== "production") {
    throw new Error("knowledge_bundle_deletion_requires_production_backend");
  }

  const db = input.db ?? getPrisma();
  const existing = await db.knowledgeBundleDeletionJob.findUnique({
    where: { bundleId: input.bundleId },
  });
  if (existing) {
    assertWorkspace(existing.workspaceId, input.workspaceId);
    await safelyEnqueue(input.enqueue ?? enqueueKnowledgeBundleDeletionJob, existing.id);
    return existing;
  }

  const bundle = await db.knowledgeBundle.findFirst({
    include: { documents: { select: { id: true, title: true } } },
    where: { id: input.bundleId, status: "active", workspaceId: input.workspaceId },
  });
  if (!bundle) {
    // A concurrent request can create the durable claim and mark the bundle
    // deleting between the first job lookup and this active-bundle lookup.
    const racedJob = await db.knowledgeBundleDeletionJob.findUnique({
      where: { bundleId: input.bundleId },
    });
    if (!racedJob) throw new Error("knowledge_bundle_not_found");
    assertWorkspace(racedJob.workspaceId, input.workspaceId);
    await safelyEnqueue(input.enqueue ?? enqueueKnowledgeBundleDeletionJob, racedJob.id);
    return racedJob;
  }

  const requestedAt = new Date();
  const manifest: KnowledgeBundleDeletionManifest = {
    bundleId: bundle.id,
    bundleName: bundle.name,
    documentIds: bundle.documents.map((document) => document.id),
    documentTitles: bundle.documents.map((document) => document.title),
    requestedAt: requestedAt.toISOString(),
    workspaceId: input.workspaceId,
  };

  let job;
  try {
    job = await db.$transaction(async (tx) => {
      const created = await tx.knowledgeBundleDeletionJob.create({
        data: {
          bundleId: bundle.id,
          bundleName: bundle.name,
          manifest: manifest as unknown as Prisma.InputJsonValue,
          requestedBy: input.actorId,
          workspaceId: input.workspaceId,
        },
      });
      await tx.knowledgeBundle.update({
        data: { status: "deleting" },
        where: { id: bundle.id },
      });
      if (manifest.documentIds.length > 0) {
        await tx.ragChunk.updateMany({
          data: { isActive: false },
          where: { documentId: { in: manifest.documentIds }, workspaceId: input.workspaceId },
        });
        await tx.document.updateMany({
          data: { knowledgeBundleId: null, ragStatus: "not_indexed" },
          where: { id: { in: manifest.documentIds }, workspaceId: input.workspaceId },
        });
      }
      return created;
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    job = await db.knowledgeBundleDeletionJob.findUnique({ where: { bundleId: bundle.id } });
    if (!job) throw error;
  }

  await safelyEnqueue(input.enqueue ?? enqueueKnowledgeBundleDeletionJob, job.id);
  return job;
}

export async function retryKnowledgeBundleDeletion(input: {
  context: AuthWorkspaceContext;
  enqueue?: EnqueueDeletion;
  jobId: string;
}) {
  const db = getPrisma();
  const job = await db.knowledgeBundleDeletionJob.findFirst({
    where: { id: input.jobId, workspaceId: input.context.workspaceId },
  });
  if (!job) throw new Error("knowledge_bundle_deletion_job_not_found");
  await db.knowledgeBundleDeletionJob.update({
    data: { errorCode: null, errorMessage: null, status: "queued" },
    where: { id: job.id },
  });
  await safelyEnqueue(input.enqueue ?? enqueueKnowledgeBundleDeletionJob, job.id);
}

export async function getKnowledgeBundleDeletionStatusSnapshot(
  context: AuthWorkspaceContext,
): Promise<KnowledgeBundleDeletionStatusSnapshot> {
  if (process.env.AV_OKF_BACKEND !== "production") {
    return { active: false, fingerprint: "local", jobs: [] };
  }
  const records = await getPrisma().knowledgeBundleDeletionJob.findMany({
    orderBy: [{ queuedAt: "desc" }, { id: "asc" }],
    where: { workspaceId: context.workspaceId },
  });
  const jobs = records.map((record) => {
    const manifest = parseManifest(record.manifest);
    return {
      bundleId: record.bundleId,
      bundleName: record.bundleName,
      completedAt: record.completedAt?.toISOString() ?? null,
      documentCount: manifest.documentIds.length,
      errorCode: record.errorCode,
      errorMessage: record.errorMessage,
      id: record.id,
      status: record.status,
    };
  });
  return {
    active: jobs.some((job) => job.status === "queued" || job.status === "running"),
    fingerprint: records.map((record) => [record.id, record.status, record.updatedAt.toISOString(), record.errorCode ?? ""].join(":" )).join("|"),
    jobs,
  };
}

export async function reconcileKnowledgeBundleDeletionJobs(
  enqueue: EnqueueDeletion = enqueueKnowledgeBundleDeletionJob,
) {
  const jobs = await getPrisma().knowledgeBundleDeletionJob.findMany({
    select: { id: true },
    where: { status: { in: ["queued", "running"] } },
  });
  for (const job of jobs) await safelyEnqueue(enqueue, job.id);
}

export async function runKnowledgeBundleDeletionJob(
  payload: KnowledgeBundleDeletionJobPayload,
  dependencies: {
    db?: ReturnType<typeof getPrisma>;
    removeBundleDirectory?: (root: string) => Promise<void>;
    writeVault?: (workspaceId: string) => Promise<void>;
  } = {},
) {
  const db = dependencies.db ?? getPrisma();
  const removeBundleDirectory = dependencies.removeBundleDirectory ??
    ((root: string) => rm(root, { force: true, recursive: true }));
  const writeVault = dependencies.writeVault ?? writeWorkspaceVault;
  const job = await db.knowledgeBundleDeletionJob.findUnique({ where: { id: payload.jobId } });
  if (!job) return;
  if (job.status === "completed") return;
  const manifest = parseManifest(job.manifest);

  await db.knowledgeBundleDeletionJob.update({
    data: {
      attempts: { increment: 1 },
      errorCode: null,
      errorMessage: null,
      startedAt: job.startedAt ?? new Date(),
      status: "running",
    },
    where: { id: job.id },
  });

  try {
    const root = resolveKnowledgeBundleRoot({
      bundleId: manifest.bundleId,
      workspaceId: manifest.workspaceId,
    });
    const counts = await db.$transaction(async (tx) => {
      const topicCount = await tx.topicRecord.count({
        where: { knowledgeBundleId: manifest.bundleId },
      });
      const chatCount = await tx.chatSession.count({
        where: { knowledgeBundleId: manifest.bundleId },
      });
      const ragCount = manifest.documentIds.length > 0
        ? await tx.ragChunk.count({ where: { documentId: { in: manifest.documentIds } } })
        : 0;
      if (manifest.documentIds.length > 0) {
        await tx.topicDiscoveryJob.deleteMany({
          where: { documentId: { in: manifest.documentIds }, workspaceId: manifest.workspaceId },
        });
        await tx.ragIndexJob.deleteMany({
          where: { documentId: { in: manifest.documentIds }, workspaceId: manifest.workspaceId },
        });
        await tx.document.updateMany({
          data: { knowledgeBundleId: null, ragStatus: "not_indexed" },
          where: { id: { in: manifest.documentIds }, workspaceId: manifest.workspaceId },
        });
      }
      const existingAudit = await tx.bundleDeletionAudit.findFirst({
        where: { bundleId: manifest.bundleId, workspaceId: manifest.workspaceId },
      });
      if (!existingAudit) {
        await tx.bundleDeletionAudit.create({
          data: {
            bundleId: manifest.bundleId,
            bundleName: manifest.bundleName,
            deletedBy: job.requestedBy,
            deletionCounts: {
              chats: chatCount,
              documentsPreserved: manifest.documentIds.length,
              ragChunks: ragCount,
              topics: topicCount,
            },
            workspaceId: manifest.workspaceId,
          },
        });
      }
      await tx.knowledgeBundle.deleteMany({
        where: { id: manifest.bundleId, workspaceId: manifest.workspaceId },
      });
      return { chats: chatCount, documentsPreserved: manifest.documentIds.length, ragChunks: ragCount, topics: topicCount };
    });

    // Remove files after the bundle row is gone so concurrent exporters can no
    // longer pass the active-bundle check and recreate content after cleanup.
    await removeBundleDirectory(root);
    await writeVault(manifest.workspaceId);
    await db.knowledgeBundleDeletionJob.update({
      data: {
        completedAt: new Date(),
        errorCode: null,
        errorMessage: null,
        manifest: { ...manifest, counts } as unknown as Prisma.InputJsonValue,
        status: "completed",
      },
      where: { id: job.id },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.knowledgeBundleDeletionJob.updateMany({
      data: { errorCode: "knowledge_bundle_deletion_failed", errorMessage: message, status: "failed" },
      where: { id: job.id },
    });
    throw error;
  }
}

function parseManifest(value: Prisma.JsonValue): KnowledgeBundleDeletionManifest {
  const manifest = value as unknown as Partial<KnowledgeBundleDeletionManifest>;
  if (!manifest.bundleId || !manifest.bundleName || !manifest.workspaceId || !Array.isArray(manifest.documentIds)) {
    throw new Error("knowledge_bundle_deletion_manifest_invalid");
  }
  return {
    bundleId: manifest.bundleId,
    bundleName: manifest.bundleName,
    documentIds: manifest.documentIds.filter((value): value is string => typeof value === "string"),
    documentTitles: Array.isArray(manifest.documentTitles)
      ? manifest.documentTitles.filter((value): value is string => typeof value === "string")
      : [],
    requestedAt: manifest.requestedAt ?? new Date(0).toISOString(),
    workspaceId: manifest.workspaceId,
  };
}

async function safelyEnqueue(enqueue: EnqueueDeletion, jobId: string) {
  try {
    await enqueue({ jobId });
  } catch (error) {
    console.error("knowledge_bundle_deletion_enqueue_failed", error);
  }
}

function assertWorkspace(actual: string, expected: string) {
  if (actual !== expected) throw new Error("knowledge_bundle_workspace_mismatch");
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

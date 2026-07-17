import { rm } from "node:fs/promises";
import { Queue } from "bullmq";

import { getPrisma } from "./prisma.ts";
import { getObjectStorage, type ObjectStorage } from "./production-storage.ts";
import { resolveKnowledgeBundleRoot, writeWorkspaceVault } from "./knowledge-bundles.ts";

export type KnowledgeBundleDeletionJob = {
  actorId: string;
  bundleId: string;
  workspaceId: string;
};

let cachedQueue: Queue<KnowledgeBundleDeletionJob> | null = null;

export function getKnowledgeBundleDeletionQueue() {
  if (!cachedQueue) {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) throw new Error("missing_env_REDIS_URL");
    cachedQueue = new Queue<KnowledgeBundleDeletionJob>("knowledge-bundle-deletion", {
      connection: { url: redisUrl },
    });
  }
  return cachedQueue;
}

export async function requestKnowledgeBundleDeletion(input: KnowledgeBundleDeletionJob & { confirmedName: string }) {
  const db = getPrisma();
  const bundle = await db.knowledgeBundle.findFirst({
    where: { id: input.bundleId, workspaceId: input.workspaceId },
  });
  if (!bundle) throw new Error("knowledge_bundle_not_found");
  if (input.confirmedName !== bundle.name) throw new Error("knowledge_bundle_name_confirmation_mismatch");
  await db.knowledgeBundle.update({ data: { status: "deleting" }, where: { id: bundle.id } });
  await getKnowledgeBundleDeletionQueue().add("delete-bundle", {
    actorId: input.actorId,
    bundleId: bundle.id,
    workspaceId: input.workspaceId,
  }, {
    attempts: 5,
    backoff: { delay: 2_000, type: "exponential" },
    jobId: `delete-bundle-${bundle.id}`,
    removeOnComplete: 100,
  });
}

export async function runKnowledgeBundleDeletionJob(
  input: KnowledgeBundleDeletionJob,
  storage: ObjectStorage = getObjectStorage(),
  dependencies: {
    db?: ReturnType<typeof getPrisma>;
    writeVault?: (workspaceId: string) => Promise<void>;
  } = {},
) {
  const db = dependencies.db ?? getPrisma();
  const writeVault = dependencies.writeVault ?? writeWorkspaceVault;
  const bundle = await db.knowledgeBundle.findFirst({
    include: {
      _count: { select: { chatSessions: true, coverageLinks: true, documents: true, topics: true } },
      documents: { include: { objects: true } },
    },
    where: { id: input.bundleId, workspaceId: input.workspaceId },
  });
  if (!bundle) {
    await writeVault(input.workspaceId);
    return;
  }
  if (bundle.status !== "deleting") throw new Error("knowledge_bundle_not_deleting");

  for (const document of bundle.documents) {
    for (const object of document.objects) await storage.deleteObject(object.objectKey);
  }

  const root = resolveKnowledgeBundleRoot({
    bundleId: bundle.id,
    workspaceId: input.workspaceId,
  });
  await rm(root, { force: true, recursive: true });

  await db.$transaction(async (tx) => {
    await tx.bundleDeletionAudit.create({
      data: {
        bundleId: bundle.id,
        bundleName: bundle.name,
        deletedBy: input.actorId,
        deletionCounts: {
          chats: bundle._count.chatSessions,
          coverageLinks: bundle._count.coverageLinks,
          documents: bundle._count.documents,
          objects: bundle.documents.reduce((sum, document) => sum + document.objects.length, 0),
          topics: bundle._count.topics,
        },
        workspaceId: input.workspaceId,
      },
    });
    await tx.knowledgeBundle.delete({ where: { id: bundle.id } });
  });
  await writeVault(input.workspaceId);
}

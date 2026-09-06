import { getPrisma } from "./prisma.ts";
export const ENRICHMENT_PROGRESS_VERSION = "selected-enrichment-progress-v1";
export async function recordEnrichmentProgress(input: {
  topicId: string;
  workspaceId: string;
  bundleId: string;
  batchId: string;
  status: string;
  queuedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}) {
  const db = getPrisma();
  const topic = await db.topicRecord.findFirst({
    where: {
      id: input.topicId,
      workspaceId: input.workspaceId,
      knowledgeBundleId: input.bundleId,
      document: { deletedAt: null },
    },
  });
  if (!topic) return;
  const data = {
    status: input.status,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
  };
  const prior=await db.topicEnrichmentJob.findUnique({where:{topicId_revisionFingerprint:{topicId:input.topicId,revisionFingerprint:input.batchId}}});
  if(prior&&prior.status===input.status&&(!input.startedAt||prior.startedAt?.getTime()===input.startedAt.getTime())&&(!input.completedAt||prior.completedAt?.getTime()===input.completedAt.getTime()))return prior;
  return db.topicEnrichmentJob.upsert({
    where: {
      topicId_revisionFingerprint: {
        topicId: input.topicId,
        revisionFingerprint: input.batchId,
      },
    },
    create: {
      workspaceId: input.workspaceId,
      knowledgeBundleId: input.bundleId,
      topicId: input.topicId,
      revisionFingerprint: input.batchId,
      promptVersion: ENRICHMENT_PROGRESS_VERSION,
      queuedAt: input.queuedAt,
      ...data,
    },
    update: data,
  });
}

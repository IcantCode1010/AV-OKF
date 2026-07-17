import type { AuthWorkspaceContext } from "./auth-workspace.ts";
import { getPrisma } from "./prisma.ts";
import { createBullMqTopicDiscoveryQueue } from "./topic-discovery-queue.ts";

export async function requestTopicDiscovery(input: {
  context: AuthWorkspaceContext;
  documentId: string;
}) {
  const db = getPrisma();
  const document = await db.document.findFirst({
    select: { id: true },
    where: { deletedAt: null, id: input.documentId, workspaceId: input.context.workspaceId },
  });
  if (!document) throw new Error("document_workspace_mismatch");
  const pageCount = await db.extractedPage.count({
    where: { documentId: document.id, workspaceId: input.context.workspaceId },
  });
  if (pageCount === 0) throw new Error("document_extraction_not_completed");
  const job = await db.topicDiscoveryJob.create({
    data: { documentId: document.id, status: "queued", workspaceId: input.context.workspaceId },
  });
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error("missing_env_REDIS_URL");
  try {
    await createBullMqTopicDiscoveryQueue(redisUrl).enqueue({
      documentId: document.id,
      topicDiscoveryJobId: job.id,
      workspaceId: input.context.workspaceId,
    });
  } catch (error) {
    console.error("Topic discovery enqueue failed; queued job remains in Postgres.", error);
  }
  return job;
}

export async function resolveProposedTopicPages(input: {
  accept: boolean;
  context: AuthWorkspaceContext;
  topicId: string;
}) {
  const db = getPrisma();
  const topic = await db.topicRecord.findFirst({
    where: { id: input.topicId, workspaceId: input.context.workspaceId },
  });
  if (!topic) throw new Error("topic_not_found");
  if (topic.reviewStatus === "approved") throw new Error("approved_topic_is_locked");
  const pages = input.accept
    ? [...new Set([...topic.sourcePageNumbers, ...topic.proposedSourcePageNumbers])].sort((a, b) => a - b)
    : topic.sourcePageNumbers;
  return db.topicRecord.update({
    data: {
      pageEnd: Math.max(...pages),
      pageStart: Math.min(...pages),
      proposedSourcePageNumbers: [],
      sourcePageNumbers: pages,
    },
    where: { id: topic.id },
  });
}

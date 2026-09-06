import { Queue } from "bullmq";
import { getPrisma } from "./prisma.ts";
import type { AuthWorkspaceContext } from "./auth-workspace.ts";
import {
  recordEnrichmentProgress,
  ENRICHMENT_PROGRESS_VERSION,
} from "./enrichment-progress.ts";
import {
  estimateRemainingSeconds,
  type ActivityItem,
} from "./activity-types.ts";
export async function getActivity(
  context: AuthWorkspaceContext,
  documentId?: string,
) {
  const db = getPrisma();
  await db.workspaceMember.findUniqueOrThrow({
    where: {
      workspaceId_userId: {
        workspaceId: context.workspaceId,
        userId: context.userId,
      },
    },
  });
  const since = new Date(Date.now() - 86400000);
  // Reconcile retained Redis jobs, including work submitted before progress tracking existed.
  if (process.env.REDIS_URL) {
    const queue = new Queue("selected-topic-enrichment", {
      connection: { url: process.env.REDIS_URL },
    });
    try {
      const jobs = await queue.getJobs(
        ["active", "waiting", "delayed", "completed", "failed"],
        0,
        999,
      );
      const scoped = jobs.filter(
        (j) => j.data.workspaceId === context.workspaceId,
      );
      const topics = await db.topicRecord.findMany({
        where: {
          id: { in: scoped.map((j) => j.data.topicId) },
          workspaceId: context.workspaceId,
          document: { deletedAt: null },
          ...(documentId ? { documentId } : {}),
        },
        select: { id: true, documentId: true },
      });
      const allowed = new Map(topics.map((t) => [t.id, t]));
      for (const job of scoped) {
        const topic = allowed.get(job.data.topicId);
        if (!topic) continue;
        const state = await job.getState();
        await recordEnrichmentProgress({
          topicId: topic.id,
          workspaceId: context.workspaceId,
          bundleId: job.data.bundleId,
          batchId: job.data.batchId ?? `legacy:${topic.documentId}`,
          status:
            state === "active"
              ? "running"
              : state === "completed"
                ? "completed"
                : state === "failed"
                  ? "failed"
                  : "queued",
          queuedAt: new Date(job.timestamp),
          startedAt: job.processedOn ? new Date(job.processedOn) : undefined,
          completedAt: job.finishedOn ? new Date(job.finishedOn) : undefined,
        });
      }
    } finally {
      await queue.close();
    }
  }
  const records = await db.topicEnrichmentJob.findMany({
    where: {
      workspaceId: context.workspaceId,
      promptVersion: ENRICHMENT_PROGRESS_VERSION,
      queuedAt: { gte: since },
      topic: {
        document: { deletedAt: null },
        ...(documentId ? { documentId } : {}),
      },
    },
    include: { topic: { include: { document: { select: { title: true } } } } },
    orderBy: { queuedAt: "asc" },
  });
  const groups = new Map<string, typeof records>();
  for (const r of records) {
    const key = r.revisionFingerprint + ":" + r.topic.documentId;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const items: ActivityItem[] = [];
  for (const [id, rows] of groups) {
    const complete = rows.filter((r) => r.status === "completed"),
      failed = rows.filter((r) => r.status === "failed"),
      active = rows.filter((r) => r.status === "running"),
      waiting = rows.filter((r) => r.status === "queued");
    const finished = complete.length + failed.length;
    const durations = complete
      .filter((r) => r.startedAt && r.completedAt)
      .map((r) => r.completedAt!.getTime() - r.startedAt!.getTime());
    items.push({
      id,
      label: `Topic enrichment · ${rows[0].topic.document.title}`,
      status: active.length
        ? "running"
        : waiting.length
          ? "queued"
          : failed.length
            ? "completed_with_warnings"
            : "completed",
      detail: active.length
        ? `Enriching ${active[0].topic.title}`
        : waiting.length
          ? "Waiting for the enrichment worker"
          : failed.length ? "Finished with failures. Open details to review drafts and retry failed topics." : "Finished — drafts are ready to review",
      href: `/knowledge/${rows[0].knowledgeBundleId}/review?documentId=${rows[0].topic.documentId}`,
      startedAt: rows[0].queuedAt.toISOString(),
      finishedAt:
        finished === rows.length
          ? new Date(
              Math.max(
                ...rows.map(
                  (r) => r.completedAt?.getTime() ?? r.updatedAt.getTime(),
                ),
              ),
            ).toISOString()
          : undefined,
      completed: finished,
      total: rows.length,
      failed: failed.length,
      remainingSeconds: estimateRemainingSeconds(
        durations,
        rows.length - finished,
      ),
    });
  }
  const [authoring, builders, extraction, research] = await Promise.all([
    db.knowledgeAuthoringRun.findMany({
      where: {
        workspaceId: context.workspaceId,
        createdAt: { gte: since },
        document: { deletedAt: null },
        ...(documentId ? { documentId } : {}),
      },
      include: { document: { select: { title: true } } },
      orderBy: { createdAt: "desc" },
      take: 15,
    }),
    documentId
      ? []
      : db.topicBuilderRun.findMany({
          where: {
            workspaceId: context.workspaceId,
            createdAt: { gte: since },
          },
          include: { recipe: { select: { topic: true } } },
          orderBy: { createdAt: "desc" },
          take: 15,
        }),
    db.extractionJob.findMany({
      where: {
        workspaceId: context.workspaceId,
        queuedAt: { gte: since },
        document: { deletedAt: null },
        ...(documentId ? { documentId } : {}),
      },
      include: { document: { select: { title: true } } },
      orderBy: { queuedAt: "desc" },
      take: 15,
    }),
    documentId
      ? []
      : db.knowledgeResearchRun.findMany({
          where: {
            workspaceId: context.workspaceId,
            userId: context.userId,
            createdAt: { gte: since },
          },
          orderBy: { createdAt: "desc" },
          take: 10,
        }),
  ]);
  for (const r of authoring)
    items.push({
      id: r.id,
      label: `Document processing · ${r.document.title}`,
      status: r.status,
      detail: r.currentStage.replaceAll("_", " "),
      href: `/documents/${r.documentId}`,
      startedAt: r.createdAt.toISOString(),
    });
  for (const r of builders)
    items.push({
      id: r.id,
      label: `Article draft · ${r.recipe.topic}`,
      status: r.status,
      detail: r.progress,
      href: "/topic-builder",
      startedAt: r.createdAt.toISOString(),
    });
  for (const r of extraction)
    items.push({
      id: r.id,
      label: `Text extraction · ${r.document.title}`,
      status: r.status,
      detail:
        r.status === "failed"
          ? "Extraction failed; open document for details"
          : "Reading source pages",
      href: `/documents/${r.documentId}`,
      startedAt: r.queuedAt.toISOString(),
      finishedAt: r.completedAt?.toISOString(),
    });
  for (const r of research)
    items.push({
      id: r.id,
      label: r.consumer === "chat" ? "Chat research" : "Article research",
      status: r.status,
      detail: r.progress,
      href:
        r.consumer === "chat" && r.ownerId
          ? `/chat/${r.ownerId}`
          : "/topic-builder",
      startedAt: r.createdAt.toISOString(),
    });
  if(!documentId){
    const approvals=await db.bulkTopicApprovalRun.findMany({where:{workspaceId:context.workspaceId,createdAt:{gte:since}},include:{items:true},orderBy:{createdAt:"desc"},take:15});
    for(const r of approvals)items.push({id:r.id,label:"Bulk topic approval and export",status:r.status,detail:r.status==="awaiting_confirmation"?"Waiting for your confirmation":"Approving selected topics and preparing their exports",href:`/knowledge/${r.knowledgeBundleId}/review/${r.id}`,startedAt:r.createdAt.toISOString(),finishedAt:r.completedAt?.toISOString(),total:r.items.length,completed:r.items.filter(i=>["succeeded","failed","skipped"].includes(i.status)).length,failed:r.items.filter(i=>i.status==="failed").length});
    const exports=await db.knowledgeExportRelease.findMany({where:{workspaceId:context.workspaceId,createdAt:{gte:since}},orderBy:{createdAt:"desc"},take:10});
    for(const r of exports)items.push({id:r.id,label:"Selected EFB export",status:r.status,detail:r.status==="exported"?"Validated export ready to download":r.status==="failed"?"Export failed. Open selections for details.":"Preparing and validating selected articles",href:"/efb-selections",startedAt:r.createdAt.toISOString()});
  }
  return {
    items: items.sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    generatedAt: new Date().toISOString(),
  };
}

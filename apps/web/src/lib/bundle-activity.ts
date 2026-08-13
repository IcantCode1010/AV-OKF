import { createHash } from "node:crypto";

import type { AuthWorkspaceContext } from "./auth-workspace.ts";
import { getKnowledgeBundle } from "./knowledge-bundles.ts";
import { getPrisma } from "./prisma.ts";
import { isProductionBackend } from "./production-document-service.ts";

export type BundleActivityStatus =
  | "queued"
  | "running"
  | "completed"
  | "action_required"
  | "failed";

export type BundleActivityItem = {
  id: string;
  documentId?: string;
  occurredAt: string;
  stage: string;
  status: BundleActivityStatus;
  title: string;
  detail: string;
  resultCount?: number;
  actionHref?: string;
};

export type BundleActivitySnapshot = {
  active: boolean;
  fingerprint: string;
  items: BundleActivityItem[];
  summary: {
    processing: number;
    awaitingReview: number;
    failed: number;
    completed: number;
  };
};

export async function getBundleActivitySnapshot({
  bundleId,
  context,
}: {
  bundleId: string;
  context: AuthWorkspaceContext;
}): Promise<BundleActivitySnapshot> {
  const bundle = await getKnowledgeBundle({ bundleId, context });
  if (!bundle) throw new Error("knowledge_bundle_not_found");
  if (!isProductionBackend()) return buildBundleActivitySnapshot([]);

  const prisma = getPrisma();
  const [documents, authoringRuns, bulkRuns, relationRuns] = await Promise.all([
    prisma.document.findMany({
      orderBy: { updatedAt: "desc" },
      select: {
        activityEvents: { orderBy: { createdAt: "desc" }, take: 8 },
        extractionJobs: { orderBy: { queuedAt: "desc" }, take: 1 },
        id: true,
        title: true,
        topicDiscoveryJobs: { orderBy: { queuedAt: "desc" }, take: 1 },
      },
      where: { deletedAt: null, knowledgeBundleId: bundleId, workspaceId: context.workspaceId },
    }),
    prisma.knowledgeAuthoringRun.findMany({
      orderBy: { updatedAt: "desc" },
      take: 50,
      where: { knowledgeBundleId: bundleId, workspaceId: context.workspaceId },
      include: { document: { select: { title: true } } },
    }),
    prisma.bulkTopicApprovalRun.findMany({
      orderBy: { updatedAt: "desc" },
      take: 30,
      where: { knowledgeBundleId: bundleId, workspaceId: context.workspaceId },
      include: { items: { select: { status: true } } },
    }),
    prisma.okfRelationDiscoveryRun.findMany({
      orderBy: { updatedAt: "desc" },
      take: 20,
      where: { knowledgeBundleId: bundleId, workspaceId: context.workspaceId },
    }),
  ]);

  const items: BundleActivityItem[] = [];
  for (const document of documents) {
    const extraction = document.extractionJobs[0];
    if (extraction) {
      items.push({
        id: `extraction:${extraction.id}`,
        documentId: document.id,
        occurredAt: (extraction.completedAt ?? extraction.startedAt ?? extraction.queuedAt).toISOString(),
        stage: "Text extraction",
        status: normalizeJobStatus(extraction.status),
        title: document.title,
        detail: extraction.errorMessage ?? describeStatus("Text extraction", extraction.status),
        actionHref: `/documents/${encodeURIComponent(document.id)}?panel=processing`,
      });
    }
    const discovery = document.topicDiscoveryJobs[0];
    if (discovery) {
      items.push({
        id: `discovery:${discovery.id}`,
        documentId: document.id,
        occurredAt: (discovery.completedAt ?? discovery.startedAt ?? discovery.queuedAt).toISOString(),
        stage: "Concept discovery",
        status: normalizeJobStatus(discovery.status),
        title: document.title,
        detail: discovery.errorMessage ?? (discovery.totalWindows > 0
          ? `${discovery.completedWindows} of ${discovery.totalWindows} document windows analyzed`
          : describeStatus("Concept discovery", discovery.status)),
        resultCount: discovery.completedWindows,
        actionHref: `/documents/${encodeURIComponent(document.id)}?panel=processing`,
      });
    }
    for (const event of document.activityEvents) {
      items.push({
        id: `event:${event.id}`,
        documentId: document.id,
        occurredAt: event.createdAt.toISOString(),
        stage: event.label,
        status: normalizeBundleActivityEventStatus(event.status),
        title: document.title,
        detail: event.label,
        actionHref: `/documents/${encodeURIComponent(document.id)}?panel=logs`,
      });
    }
  }

  for (const run of authoringRuns) {
    items.push({
      id: `authoring:${run.id}`,
      documentId: run.documentId,
      occurredAt: run.updatedAt.toISOString(),
      stage: formatStage(run.currentStage),
      status: normalizeAuthoringStatus(run.status),
      title: run.document.title,
      detail: run.errorMessage ?? describeStatus(formatStage(run.currentStage), run.status),
      actionHref: `/documents/${encodeURIComponent(run.documentId)}?panel=processing`,
    });
  }

  for (const run of bulkRuns) {
    const succeeded = run.items.filter((item) => item.status === "succeeded").length;
    const failed = run.items.filter((item) => item.status === "failed").length;
    items.push({
      id: `bulk:${run.id}`,
      occurredAt: run.updatedAt.toISOString(),
      stage: "Topic approval and export",
      status: normalizeBulkStatus(run.status),
      title: run.mode === "automated" ? "Automatic topic approval" : "Bulk topic approval",
      detail: run.errorMessage ?? `${succeeded} exported${failed > 0 ? `, ${failed} failed` : ""}`,
      resultCount: succeeded,
      actionHref: `/knowledge/${encodeURIComponent(bundleId)}/review?run=${encodeURIComponent(run.id)}`,
    });
  }

  for (const run of relationRuns) {
    items.push({
      id: `relations:${run.id}`,
      occurredAt: run.updatedAt.toISOString(),
      stage: "Relation verification",
      status: normalizeRelationStatus(run.status, run.failedCount),
      title: "Relation discovery",
      detail: `${run.confirmedCount} confirmed, ${run.filteredCount} filtered, ${run.failedCount} failed`,
      resultCount: run.confirmedCount,
      actionHref: `/knowledge/${encodeURIComponent(bundleId)}/relations`,
    });
  }

  return buildBundleActivitySnapshot(items);
}

export function buildBundleActivitySnapshot(items: BundleActivityItem[]): BundleActivitySnapshot {
  const sorted = [...items]
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id))
    .slice(0, 150);
  const active = sorted.some((item) => item.status === "queued" || item.status === "running");
  const fingerprint = createHash("sha256")
    .update(sorted.map((item) => `${item.id}:${item.status}:${item.occurredAt}:${item.detail}`).join("|"))
    .digest("hex");
  return {
    active,
    fingerprint,
    items: sorted,
    summary: {
      processing: sorted.filter((item) => item.status === "queued" || item.status === "running").length,
      awaitingReview: sorted.filter((item) => item.status === "action_required").length,
      failed: sorted.filter((item) => item.status === "failed").length,
      completed: sorted.filter((item) => item.status === "completed").length,
    },
  };
}

function normalizeJobStatus(status: string): BundleActivityStatus {
  if (["queued", "analyzing", "consolidating"].includes(status)) return status === "queued" ? "queued" : "running";
  if (["running", "processing", "exporting", "approving"].includes(status)) return "running";
  if (["failed", "completed_with_failures"].includes(status)) return "failed";
  if (["needs_review", "awaiting_confirmation", "ready"].includes(status)) return "action_required";
  return "completed";
}

function normalizeAuthoringStatus(status: string): BundleActivityStatus {
  if (["queued", "running"].includes(status)) return status as "queued" | "running";
  if (["failed", "blocked"].includes(status)) return "failed";
  if (["awaiting_cost_confirmation", "ready", "review_required"].includes(status)) return "action_required";
  return "completed";
}

function normalizeBulkStatus(status: string): BundleActivityStatus {
  if (status === "queued") return "queued";
  if (status === "running") return "running";
  if (status === "awaiting_confirmation") return "action_required";
  if (["failed", "completed_with_failures"].includes(status)) return "failed";
  return "completed";
}

function normalizeRelationStatus(status: string, failedCount: number): BundleActivityStatus {
  if (["queued", "running"].includes(status)) return status as "queued" | "running";
  if (failedCount > 0 || status === "failed") return "failed";
  return "completed";
}

export function normalizeBundleActivityEventStatus(status: string): BundleActivityStatus {
  // ActivityEvent rows are immutable historical observations. Current work is
  // represented by its job/run record, so old processing, failure, or review
  // events must not keep polling or attention counts alive after resolution.
  void status;
  return "completed";
}

function formatStage(stage: string) {
  return stage.replaceAll("_", " ").replace(/^./, (value) => value.toUpperCase());
}

function describeStatus(stage: string, status: string) {
  return `${stage} is ${status.replaceAll("_", " ")}.`;
}

import type { AuthWorkspaceContext } from "./auth-workspace.ts";
import { summarizeExtractionMethodCounts } from "./document-batch-progress.ts";
import type { OperationProgress, OperationProgressSnapshot } from "./operation-progress.ts";
import { serializeDocumentProcessingFingerprint } from "./document-processing-state.ts";
import { getPrisma } from "./prisma.ts";

export type DocumentProcessingProgressData = {
  extraction: { completed: number; ocrPages: number; status: string; total: number };
  topicDiscovery: { completed: number; status: string; total: number };
  ragIndex: { completed: number; status: string; total: number } | null;
  authoring: { completedStages: string[]; currentStage: string | null; status: string } | null;
  automaticApproval: { completed: number; failed: number; status: string; total: number } | null;
  entities: { completed: number; failed: number; queued: number; running: number };
  efbRelease: { articleCount: number; errorCode: string | null; releaseDirectory: string | null; status: string } | null;
};

export async function getProductionDocumentProcessingStatusSnapshot(input: {
  context: AuthWorkspaceContext;
  documentId: string;
}): Promise<OperationProgressSnapshot<DocumentProcessingProgressData> | null> {
  const document = await getPrisma().document.findFirst({
    select: {
      extractionJobs: {
        orderBy: { queuedAt: "desc" },
        select: {
          errorCode: true,
          checkpoints: { select: { status: true }, where: { stage: "extraction" } },
          status: true,
        },
        take: 1,
      },
      inspectionStatus: true,
      entityExtractionJobs: {
        select: { status: true },
      },
      efbReleaseJobs: {
        orderBy: { createdAt: "desc" },
        select: { articleCount: true, errorCode: true, id: true, releaseDirectory: true, status: true },
        take: 1,
      },
      knowledgeAuthoringRuns: {
        orderBy: { createdAt: "desc" },
        select: {
          automaticApprovalRun: {
            select: {
              id: true,
              items: { select: { status: true } },
              status: true,
            },
          },
          completedStages: true,
          currentStage: true,
          errorMessage: true,
          id: true,
          status: true,
        },
        take: 1,
      },
      ragIndexJobs: {
        orderBy: { queuedAt: "desc" },
        select: { batchCheckpoints: { select: { status: true } }, status: true },
        take: 1,
      },
      topicDiscoveryJobs: {
        orderBy: { queuedAt: "desc" },
        select: {
          completedWindows: true,
          errorMessage: true,
          status: true,
          totalWindows: true,
        },
        take: 1,
        where: {
          OR: [
            { errorCode: null },
            { errorCode: { not: "topic_discovery_superseded_by_active_job" } },
          ],
        },
      },
    },
    where: {
      deletedAt: null,
      id: input.documentId,
      workspaceId: input.context.workspaceId,
    },
  });
  if (!document) return null;

  const extractionMethodCounts = await getPrisma().extractedPage.groupBy({
    _count: { _all: true },
    by: ["extractionMethod"],
    where: { documentId: input.documentId },
  });
  const methodCounts = summarizeExtractionMethodCounts(extractionMethodCounts);

  const extraction = document.extractionJobs[0];
  const authoring = document.knowledgeAuthoringRuns[0];
  const automaticApproval = authoring?.automaticApprovalRun;
  const topicDiscovery = document.topicDiscoveryJobs[0];
  const ragIndex = document.ragIndexJobs[0];
  const entityConnections = {
    completed: document.entityExtractionJobs.filter((job) => job.status === "completed").length,
    failed: document.entityExtractionJobs.filter((job) => ["completed_with_warnings", "failed"].includes(job.status)).length,
    queued: document.entityExtractionJobs.filter((job) => job.status === "queued").length,
    running: document.entityExtractionJobs.filter((job) => job.status === "running").length,
  };
  const efbRelease = document.efbReleaseJobs[0] ?? null;

  const fingerprint = `${serializeDocumentProcessingFingerprint({
    authoring: authoring
      ? {
          completedStages: authoring.completedStages,
          currentStage: authoring.currentStage,
          errorMessage: authoring.errorMessage,
          id: authoring.id,
          status: authoring.status,
        }
      : null,
    automaticApproval: automaticApproval
      ? {
          id: automaticApproval.id,
          itemStatuses: automaticApproval.items.map((item) => item.status),
          status: automaticApproval.status,
        }
      : null,
    entityConnections,
    extraction: {
      completedBatches: extraction?.checkpoints.filter((item) => item.status === "completed").length ?? 0,
      errorCode: extraction?.errorCode ?? null,
      inspectionStatus: document.inspectionStatus,
      ocrPageCount: methodCounts.ocr,
      pageCount: methodCounts.total,
      status: extraction?.status ?? "queued",
      totalBatches: extraction?.checkpoints.length ?? 0,
    },
    ragIndex: ragIndex ? {
      completedBatches: ragIndex.batchCheckpoints.filter((item) => item.status === "completed").length,
      status: ragIndex.status,
      totalBatches: ragIndex.batchCheckpoints.length,
    } : null,
    topicDiscovery: {
      completedWindows: topicDiscovery?.completedWindows ?? 0,
      errorMessage: topicDiscovery?.errorMessage ?? null,
      status: topicDiscovery?.status ?? "not_started",
      totalWindows: topicDiscovery?.totalWindows ?? 0,
    },
  })}|${efbRelease ? `${efbRelease.id}:${efbRelease.status}:${efbRelease.articleCount}` : "no-efb-release"}`;

  const active =
      ["queued", "running"].includes(extraction?.status ?? "") ||
      ["queued", "analyzing", "consolidating"].includes(
        topicDiscovery?.status ?? "",
      ) ||
      ["queued", "running", "waiting_for_rag"].includes(authoring?.status ?? "") ||
      ["queued", "running", "awaiting_budget"].includes(ragIndex?.status ?? "") ||
      ["queued", "running"].includes(automaticApproval?.status ?? "") ||
      ["queued", "running"].includes(efbRelease?.status ?? "") ||
      entityConnections.queued > 0 || entityConnections.running > 0;
  const data: DocumentProcessingProgressData = {
    authoring: authoring ? {
      completedStages: authoring.completedStages,
      currentStage: authoring.currentStage,
      status: authoring.status,
    } : null,
    automaticApproval: automaticApproval ? {
      completed: automaticApproval.items.filter((item) => item.status === "succeeded").length,
      failed: automaticApproval.items.filter((item) => item.status === "failed").length,
      status: automaticApproval.status,
      total: automaticApproval.items.length,
    } : null,
    entities: entityConnections,
    efbRelease: efbRelease ? {
      articleCount: efbRelease.articleCount,
      errorCode: efbRelease.errorCode,
      releaseDirectory: efbRelease.releaseDirectory,
      status: efbRelease.status,
    } : null,
    extraction: {
      completed: extraction?.checkpoints.filter((item) => item.status === "completed").length ?? 0,
      ocrPages: methodCounts.ocr,
      status: extraction?.status ?? "queued",
      total: extraction?.checkpoints.length ?? 0,
    },
    ragIndex: ragIndex ? {
      completed: ragIndex.batchCheckpoints.filter((item) => item.status === "completed").length,
      status: ragIndex.status,
      total: ragIndex.batchCheckpoints.length,
    } : null,
    topicDiscovery: {
      completed: topicDiscovery?.completedWindows ?? 0,
      status: topicDiscovery?.status ?? "not_started",
      total: topicDiscovery?.totalWindows ?? 0,
    },
  };
  const operations = buildOperations(input.documentId, data);
  return {
    active,
    data,
    fingerprint,
    generatedAt: new Date().toISOString(),
    operations,
  };
}

function buildOperations(documentId: string, data: DocumentProcessingProgressData): OperationProgress[] {
  const now = new Date().toISOString();
  const operations: OperationProgress[] = [];
  operations.push({
    completed: data.extraction.completed,
    detail: data.extraction.total > 0
      ? `${data.extraction.completed} of ${data.extraction.total} extraction batches complete; ${data.extraction.ocrPages} OCR pages.`
      : "Inspecting the PDF and preparing extraction batches.",
    id: `${documentId}:extraction`, kind: "document_processing", label: "Text extraction",
    stage: data.extraction.status, status: normalizeStatus(data.extraction.status), total: data.extraction.total, updatedAt: now,
  });
  operations.push({
    completed: data.topicDiscovery.completed,
    detail: data.topicDiscovery.total > 0
      ? `${data.topicDiscovery.completed} of ${data.topicDiscovery.total} discovery windows complete.`
      : "Waiting for extracted pages.",
    id: `${documentId}:discovery`, kind: "document_processing", label: "Topic discovery",
    stage: data.topicDiscovery.status, status: normalizeStatus(data.topicDiscovery.status), total: data.topicDiscovery.total, updatedAt: now,
  });
  if (data.ragIndex) operations.push({
    completed: data.ragIndex.completed,
    detail: `${data.ragIndex.completed} of ${data.ragIndex.total} indexing batches complete.`,
    id: `${documentId}:rag`, kind: "document_processing", label: "Search indexing",
    stage: data.ragIndex.status, status: normalizeStatus(data.ragIndex.status), total: data.ragIndex.total, updatedAt: now,
  });
  if (data.authoring) operations.push({
    completed: data.authoring.completedStages.length,
    currentItem: data.authoring.currentStage ?? undefined,
    detail: data.authoring.currentStage ? `Current stage: ${humanize(data.authoring.currentStage)}.` : "Preparing authoring.",
    id: `${documentId}:authoring`, kind: "document_processing", label: "Knowledge authoring",
    stage: data.authoring.currentStage ?? data.authoring.status, status: normalizeStatus(data.authoring.status), updatedAt: now,
  });
  if (data.entities.queued + data.entities.running + data.entities.completed + data.entities.failed > 0) operations.push({
    completed: data.entities.completed,
    detail: `${data.entities.completed} complete, ${data.entities.running} running, ${data.entities.queued} queued, ${data.entities.failed} failed.`,
    id: `${documentId}:entities`, kind: "document_processing", label: "Entities and connections",
    stage: data.entities.running > 0 ? "running" : data.entities.queued > 0 ? "queued" : data.entities.failed > 0 ? "completed_with_warnings" : "completed",
    status: data.entities.running > 0 ? "running" : data.entities.queued > 0 ? "queued" : data.entities.failed > 0 ? "completed_with_warnings" : "completed",
    total: data.entities.completed + data.entities.running + data.entities.queued + data.entities.failed, updatedAt: now,
  });
  if (data.automaticApproval) operations.push({
    completed: data.automaticApproval.completed + data.automaticApproval.failed,
    detail: `${data.automaticApproval.completed} exported, ${data.automaticApproval.failed} failed.`,
    id: `${documentId}:approval`, kind: "document_processing", label: "Automatic approval and export",
    stage: data.automaticApproval.status, status: normalizeStatus(data.automaticApproval.status), total: data.automaticApproval.total, updatedAt: now,
  });
  if (data.efbRelease) operations.push({
    completed: data.efbRelease.status === "completed" ? data.efbRelease.articleCount : 0,
    currentItem: data.efbRelease.releaseDirectory
      ? `dist/efb-releases/${data.efbRelease.releaseDirectory.replaceAll("\\", "/").split("/").pop()}`
      : undefined,
    detail: data.efbRelease.status === "completed"
      ? `${data.efbRelease.articleCount} prototype articles are ready for Project EFB import.`
      : data.efbRelease.status === "failed"
        ? `Prototype package validation failed (${data.efbRelease.errorCode ?? "unknown error"}). The release was not activated.`
        : "Building and validating the Project EFB prototype package.",
    id: `${documentId}:efb-release`,
    kind: "efb_release",
    label: "Project EFB prototype export",
    stage: data.efbRelease.status,
    status: normalizeStatus(data.efbRelease.status),
    total: data.efbRelease.articleCount,
    updatedAt: now,
  });
  return operations;
}

function normalizeStatus(status: string): OperationProgress["status"] {
  if (["failed", "cancelled", "completed", "completed_with_warnings", "queued", "running"].includes(status)) {
    return status as OperationProgress["status"];
  }
  if (["awaiting_budget", "awaiting_confirmation", "needs_review", "action_required"].includes(status)) return "action_required";
  if (["analyzing", "consolidating", "waiting_for_rag"].includes(status)) return "running";
  return status === "not_started" ? "queued" : "completed";
}

function humanize(value: string) {
  return value.replaceAll("_", " ");
}

import type { AuthWorkspaceContext } from "./auth-workspace.ts";
import { summarizeExtractionMethodCounts } from "./document-batch-progress.ts";
import { serializeDocumentProcessingFingerprint } from "./document-processing-state.ts";
import { getPrisma } from "./prisma.ts";

export async function getProductionDocumentProcessingStatusSnapshot(input: {
  context: AuthWorkspaceContext;
  documentId: string;
}): Promise<{ active: boolean; fingerprint: string } | null> {
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

  const fingerprint = serializeDocumentProcessingFingerprint({
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
  });

  return {
    active:
      ["queued", "running"].includes(extraction?.status ?? "") ||
      ["queued", "analyzing", "consolidating"].includes(
        topicDiscovery?.status ?? "",
      ) ||
      ["queued", "running", "waiting_for_rag"].includes(authoring?.status ?? "") ||
      ["queued", "running", "awaiting_budget"].includes(ragIndex?.status ?? "") ||
      ["queued", "running"].includes(automaticApproval?.status ?? "") ||
      entityConnections.queued > 0 || entityConnections.running > 0,
    fingerprint,
  };
}

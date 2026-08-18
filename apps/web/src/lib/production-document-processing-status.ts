import type { AuthWorkspaceContext } from "./auth-workspace.ts";
import { serializeDocumentProcessingFingerprint } from "./document-processing-state.ts";
import { getPrisma } from "./prisma.ts";

export async function getProductionDocumentProcessingStatusSnapshot(input: {
  context: AuthWorkspaceContext;
  documentId: string;
}): Promise<{ active: boolean; fingerprint: string } | null> {
  const document = await getPrisma().document.findFirst({
    select: {
      _count: { select: { extractedPages: true } },
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
      ocrPageCount: true,
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
      },
    },
    where: {
      deletedAt: null,
      id: input.documentId,
      workspaceId: input.context.workspaceId,
    },
  });
  if (!document) return null;

  const extraction = document.extractionJobs[0];
  const authoring = document.knowledgeAuthoringRuns[0];
  const automaticApproval = authoring?.automaticApprovalRun;
  const topicDiscovery = document.topicDiscoveryJobs[0];
  const ragIndex = document.ragIndexJobs[0];

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
    extraction: {
      completedBatches: extraction?.checkpoints.filter((item) => item.status === "completed").length ?? 0,
      errorCode: extraction?.errorCode ?? null,
      inspectionStatus: document.inspectionStatus,
      ocrPageCount: document.ocrPageCount,
      pageCount: document._count.extractedPages,
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
      ["queued", "running"].includes(automaticApproval?.status ?? ""),
    fingerprint,
  };
}

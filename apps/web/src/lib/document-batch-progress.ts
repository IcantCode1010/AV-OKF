import { isProductionBackend } from "./production-document-service.ts";
import { getPrisma } from "./prisma.ts";

export type DocumentBatchProgress = {
  completedBatches: number;
  completedPages: number;
  inspectionStatus: string;
  ocrPages: number;
  totalBatches: number;
  totalPages: number;
  unreadablePages: number;
};

export async function getDocumentBatchProgress(documentId: string, workspaceId: string): Promise<DocumentBatchProgress | null> {
  if (!isProductionBackend()) return null;
  const document = await getPrisma().document.findFirst({
    select: {
      _count: { select: { extractedPages: true } },
      extractionJobs: {
        orderBy: { queuedAt: "desc" },
        select: { checkpoints: { select: { status: true }, where: { stage: "extraction" } } },
        take: 1,
      },
      inspectionStatus: true,
      ocrPageCount: true,
      pages: true,
      unreadablePageNumbers: true,
    },
    where: { deletedAt: null, id: documentId, workspaceId },
  });
  if (!document) return null;
  const checkpoints = document.extractionJobs[0]?.checkpoints ?? [];
  return {
    completedBatches: checkpoints.filter((item) => item.status === "completed").length,
    completedPages: document._count.extractedPages,
    inspectionStatus: document.inspectionStatus,
    ocrPages: document.ocrPageCount,
    totalBatches: checkpoints.length,
    totalPages: document.pages,
    unreadablePages: document.unreadablePageNumbers.length,
  };
}

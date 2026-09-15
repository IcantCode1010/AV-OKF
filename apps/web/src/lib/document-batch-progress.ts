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

type ExtractionMethodCount = {
  _count: { _all: number };
  extractionMethod: string;
};

export async function getDocumentBatchProgress(documentId: string, workspaceId: string): Promise<DocumentBatchProgress | null> {
  if (!isProductionBackend()) return null;
  const db = getPrisma();
  const document = await db.document.findFirst({
    select: {
      extractionJobs: {
        orderBy: { queuedAt: "desc" },
        select: { checkpoints: { select: { status: true }, where: { stage: "extraction" } } },
        take: 1,
      },
      inspectionStatus: true,
      pages: true,
    },
    where: { deletedAt: null, id: documentId, workspaceId },
  });
  if (!document) return null;
  const extractionMethodCounts = await db.extractedPage.groupBy({
    _count: { _all: true },
    by: ["extractionMethod"],
    where: { documentId },
  });
  const methodCounts = summarizeExtractionMethodCounts(extractionMethodCounts);
  const checkpoints = document.extractionJobs[0]?.checkpoints ?? [];
  return {
    completedBatches: checkpoints.filter((item) => item.status === "completed").length,
    completedPages: methodCounts.total,
    inspectionStatus: document.inspectionStatus,
    ocrPages: methodCounts.ocr,
    totalBatches: checkpoints.length,
    totalPages: document.pages,
    unreadablePages: methodCounts.unreadable,
  };
}

export function summarizeExtractionMethodCounts(rows: ExtractionMethodCount[]) {
  return rows.reduce(
    (summary, row) => ({
      ocr: summary.ocr + (row.extractionMethod === "ocr" ? row._count._all : 0),
      total: summary.total + row._count._all,
      unreadable:
        summary.unreadable
        + (row.extractionMethod === "unreadable" ? row._count._all : 0),
    }),
    { ocr: 0, total: 0, unreadable: 0 },
  );
}

import { getPrisma } from "@/lib/prisma";
export async function SourceReadiness({
  workspaceId,
  documentId,
}: {
  workspaceId: string;
  documentId: string;
}) {
  const db = getPrisma();
  const [doc, pages, figures, graph, run] = await Promise.all([
    db.document.findFirstOrThrow({
      where: { id: documentId, workspaceId, deletedAt: null },
      select: { pages: true, ragStatus: true },
    }),
    db.extractedPage.findMany({
      where: { documentId, workspaceId },
      select: { tables: true, charCount: true, warningCodes: true },
    }),
    db.documentMediaAsset.count({ where: { documentId, workspaceId } }),
    db.entityExtractionJob.groupBy({
      by: ["status"],
      where: { documentId, workspaceId },
      _count: true,
    }),
    db.knowledgeAuthoringRun.findFirst({
      where: { documentId, workspaceId },
      orderBy: { createdAt: "desc" },
      include: {
        stageAudits: {
          where: { stage: "media_discovery" },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    }),
  ]);
  const textReady = doc.pages > 0 && pages.length === doc.pages;
  const tables = pages.reduce(
    (sum, p) => sum + (Array.isArray(p.tables) ? p.tables.length : 0),
    0,
  );
  const visualWarning = !!run?.stageAudits[0]?.errorMessage;
  const states = [
    [
      "Text",
      textReady
        ? `${pages.length} pages extracted`
        : `${pages.length}/${doc.pages} pages extracted`,
    ],
    [
      "Tables",
      tables
        ? `${tables} extracted tables`
        : textReady
          ? "No tables detected"
          : "Waiting for extraction",
    ],
    ["Search", doc.ragStatus],
    [
      "Figures",
      visualWarning
        ? `${figures} figures · discovery needs attention`
        : figures
          ? `${figures} source figures`
          : run?.completedStages.includes("media_discovery")
            ? "No figures detected — manual page selection available in articles"
            : "Discovery pending",
    ],
    [
      "Knowledge graph",
      graph.length
        ? graph.map((g) => `${g._count} ${g.status}`).join(" · ")
        : "Processing pending",
    ],
  ];
  return (
    <section className="space-y-3 rounded-xl border p-4">
      <h2 className="font-semibold">Source readiness</h2>
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {states.map(([label, status]) => (
          <div key={label}>
            <dt className="text-sm font-medium">{label}</dt>
            <dd className="text-sm text-muted-foreground">{status}</dd>
          </div>
        ))}
      </dl>
      {pages.some((p) => p.warningCodes.length > 0) && (
        <p className="text-sm">
          Some pages have extraction warnings. Review the source processing
          details before using them.
        </p>
      )}
    </section>
  );
}

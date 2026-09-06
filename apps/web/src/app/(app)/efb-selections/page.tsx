import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import { getPrisma } from "@/lib/prisma";
import { knowledgeFeature } from "@/lib/knowledge/contracts";
import { assertArticleSourcesCurrent } from "@/lib/knowledge/editorial";
import { KnowledgeActionForm } from "@/components/knowledge-action-form";
export default async function EfbSelections() {
  if (!knowledgeFeature("shared") || !knowledgeFeature("export")) notFound();
  const context = await requireAuthWorkspaceContext(),
    db = getPrisma();
  const selections = await db.knowledgeEfbSelection.findMany({
    where: { workspaceId: context.workspaceId },
    orderBy: { createdAt: "asc" },
  });
  const releases = await db.knowledgeExportRelease.findMany({
    where: { workspaceId: context.workspaceId },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  const rows = await Promise.all(
    selections.map(async (s) => {
      const revision = await db.knowledgeArticleRevision.findFirst({
        where: { id: s.revisionId, workspaceId: context.workspaceId },
      });
      let available = true;
      try {
        await assertArticleSourcesCurrent(context, s.revisionId);
      } catch {
        available = false;
      }
      const visuals = await db.knowledgeVisual.findMany({
        where: {
          workspaceId: context.workspaceId,
          articleRevisionId: s.revisionId,
        },
        select: { id: true, caption: true, reviewedAt: true },
      });
      return { s, revision, available, visuals };
    }),
  );
  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <h1 className="text-2xl font-semibold">EFB selections</h1>
      <p>
        Only these approved revisions and their declared assets will be
        packaged. Export creates a downloadable release; it does not publish to
        EFB.
      </p>
      <Link className="underline" href="/articles">
        Choose articles
      </Link>
      {rows.length === 0 ? (
        <p>No articles selected.</p>
      ) : (
        rows.map(({ s, revision, available, visuals }) => (
          <section key={s.id} className="space-y-3 rounded border p-4">
            <Link
              className="font-semibold underline"
              href={`/articles/${s.articleId}`}
            >
              {(revision?.body as { title?: string })?.title ??
                "Unavailable article"}
            </Link>
            <p>
              {available
                ? "Approved · Selected for EFB"
                : "Source changed or unavailable — export blocked"}
            </p>
            <pre className="overflow-auto whitespace-pre-wrap text-xs">
              {JSON.stringify(s.metadata, null, 2)}
            </pre>
            <p>{visuals.length} supporting visuals</p>
            <ul>
              {visuals.map((v) => (
                <li key={v.id}>
                  {v.caption} · {v.reviewedAt ? "reviewed" : "review required"}
                </li>
              ))}
            </ul>
            <KnowledgeActionForm>
              <input type="hidden" name="action" value="unselect" />
              <input type="hidden" name="selectionId" value={s.id} />
              <button className="rounded border px-3 py-2">
                Remove from selection
              </button>
            </KnowledgeActionForm>
          </section>
        ))
      )}
      {rows.length > 0 && rows.every((r) => r.available) && (
        <KnowledgeActionForm>
          <input type="hidden" name="action" value="export" />
          <button className="rounded bg-primary px-4 py-2 text-primary-foreground">
            Validate and export selected revisions
          </button>
        </KnowledgeActionForm>
      )}
      <h2 className="text-xl font-semibold">Export history</h2>
      {releases.map((r) => (
        <div key={r.id} className="rounded border p-3">
          <p>
            {r.createdAt.toISOString()} · {r.status}
          </p>
          {r.error && <p role="alert">{r.error.replaceAll("_", " ")}</p>}
          {r.status === "exported" && (
            <a className="underline" href={`/api/knowledge-exports/${r.id}`}>
              Download validated package
            </a>
          )}
        </div>
      ))}
    </div>
  );
}

import Link from "next/link";
import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import { getPrisma } from "@/lib/prisma";
import { knowledgeFeature } from "@/lib/knowledge/contracts";
import { KnowledgeActionForm } from "@/components/knowledge-action-form";
export const dynamic = "force-dynamic";
export default async function ArticlesPage() {
  const context = await requireAuthWorkspaceContext();
  if (!knowledgeFeature("shared"))
    return <p>Shared editorial workspace is not enabled.</p>;
  const db = getPrisma();
  const [articles, topics] = await Promise.all([
    db.knowledgeArticle.findMany({
      where: { workspaceId: context.workspaceId },
      include: { revisions: { orderBy: { createdAt: "desc" }, take: 1 } },
      orderBy: { updatedAt: "desc" },
    }),
    db.topicRecord.findMany({
      where: {
        workspaceId: context.workspaceId,
        enrichedBody: null,
        document: { deletedAt: null },
      },
      select: { id: true, title: true, document: { select: { title: true } } },
      orderBy: { title: "asc" },
    }),
  ]);
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <h1 className="text-3xl font-semibold">Articles and topic proposals</h1>
      <p>Review knowledge for AV-OKF. EFB inclusion is a separate selection.</p>
      <Link className="underline" href="/topic-builder">
        Create a topic recipe
      </Link>
      <KnowledgeActionForm>
        <input type="hidden" name="action" value="backfill" />
        <button className="rounded border px-3 py-2">
          Import existing article snapshots
        </button>
      </KnowledgeActionForm>
      {articles.map((a) => {
        const r = a.revisions[0],
          b = r?.body as { title?: string };
        return (
          <article key={a.id} className="rounded border p-4">
            <Link className="font-medium underline" href={`/articles/${a.id}`}>
              {b?.title ?? a.originId}
            </Link>
            <p className="text-sm text-muted-foreground">
              {r?.approval ? "Approved revision" : "Draft"} · {a.originKind} ·{" "}
              {r?.legacy ? "Legacy snapshot" : "Structured evidence"}
            </p>
          </article>
        );
      })}
      <h2 className="text-xl font-semibold">Topics available to draft</h2>
      {topics.map((t) => (
        <div key={t.id} className="rounded border p-3">
          <p>
            {t.title} · {t.document.title}
          </p>
          <KnowledgeActionForm>
            <input type="hidden" name="action" value="draft-topic" />
            <input type="hidden" name="topicId" value={t.id} />
            <button className="rounded border px-3 py-2">
              Draft this topic
            </button>
          </KnowledgeActionForm>
        </div>
      ))}
    </div>
  );
}

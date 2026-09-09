import Link from "next/link";
import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import { getPrisma } from "@/lib/prisma";
import { knowledgeFeature } from "@/lib/knowledge/contracts";
import { KnowledgeActionForm } from "@/components/knowledge-action-form";
import { ArticleLibrary, type ArticleLibraryRow } from "@/components/article-library";
export const dynamic = "force-dynamic";
export default async function ArticlesPage() {
  const context = await requireAuthWorkspaceContext();
  if (!knowledgeFeature("shared"))
    return <p>Shared editorial workspace is not enabled.</p>;
  const db = getPrisma();
  const [articles, topics, classifications, selections] = await Promise.all([
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
    db.knowledgeEfbClassification.findMany({
      where: { workspaceId: context.workspaceId },
      select: { revisionId: true, status: true },
      orderBy: { createdAt: "desc" },
    }),
    db.knowledgeEfbSelection.findMany({
      where: { workspaceId: context.workspaceId },
      select: { articleId: true, revisionId: true },
    }),
  ]);
  const classificationsByRevision = new Map<string, string>();
  for (const item of classifications) {
    if (!classificationsByRevision.has(item.revisionId)) classificationsByRevision.set(item.revisionId, item.status);
  }
  const selectionsByArticle = new Map(selections.map((item) => [item.articleId, item.revisionId]));
  const articleRows: ArticleLibraryRow[] = articles.map((article) => {
    const revision = article.revisions[0];
    const body = revision?.body as { title?: string } | undefined;
    const classificationStatus = revision ? classificationsByRevision.get(revision.id) : undefined;
    return {
      articleId: article.id,
      revisionId: revision?.id ?? null,
      title: body?.title ?? article.originId,
      version: revision?.version ?? null,
      origin: article.originKind === "topic" ? "Document topic" : article.originKind,
      approved: Boolean(revision?.approval && article.approvedRevisionId === revision.id),
      metadataStatus: classificationStatus === "ready" ? "ready" : classificationStatus ? "needs_correction" : "not_applied",
      selectedForEfb: revision ? selectionsByArticle.get(article.id) === revision.id : false,
    };
  });
  return (
    <div className="w-full space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Articles</h1>
          <p className="text-sm text-muted-foreground">Edit approved knowledge or select articles for a Project EFB package.</p>
        </div>
        <div className="flex gap-3 text-sm">
          <Link className="font-medium underline" href="/topic-builder">Create article</Link>
          <Link className="font-medium underline" href="/efb-selections">Package history</Link>
        </div>
      </header>
      <ArticleLibrary rows={articleRows} />
      <details className="rounded-md border bg-card">
        <summary className="cursor-pointer px-4 py-3 font-medium">Topic proposals awaiting an article ({topics.length})</summary>
        <div className="divide-y border-t">
          {topics.map((topic) => (
            <div key={topic.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div><p className="font-medium">{topic.title}</p><p className="text-xs text-muted-foreground">{topic.document.title}</p></div>
              <KnowledgeActionForm>
                <input type="hidden" name="action" value="draft-topic" />
                <input type="hidden" name="topicId" value={topic.id} />
                <button className="rounded-md border px-3 py-2 text-sm">Create article draft</button>
              </KnowledgeActionForm>
            </div>
          ))}
          {!topics.length && <p className="px-4 py-5 text-sm text-muted-foreground">No topic proposals are waiting to be drafted.</p>}
        </div>
      </details>
      <details className="rounded-md border px-4 py-3 text-sm">
        <summary className="cursor-pointer font-medium">Article maintenance</summary>
        <div className="pt-3"><KnowledgeActionForm><input type="hidden" name="action" value="backfill" /><button className="rounded-md border px-3 py-2">Import existing article snapshots</button></KnowledgeActionForm></div>
      </details>
    </div>
  );
}

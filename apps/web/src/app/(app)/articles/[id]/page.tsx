import { ArticleSourceStatus } from "@/components/article-source-status";
import { activeArticleVisuals } from "@/lib/knowledge/visual-revisions";
import { knowledgeFeature } from "@/lib/knowledge/contracts";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import { getPrisma } from "@/lib/prisma";
import { KnowledgeActionForm } from "@/components/knowledge-action-form";
import { ArticleVisualFields } from "@/components/article-visual-fields";
import { EfbSelectionFields } from "@/components/efb-selection-fields";
import type { BuilderResult } from "@/lib/topic-builder-core";
export const dynamic = "force-dynamic";
export default async function ArticlePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!knowledgeFeature("shared")) notFound();
  const context = await requireAuthWorkspaceContext(),
    db = getPrisma();
  const article = await db.knowledgeArticle.findFirst({
    where: { workspaceId: context.workspaceId, id: (await params).id },
    include: { revisions: { orderBy: { createdAt: "desc" } } },
  });
  if (!article) notFound();
  return (
    <div className="mx-auto w-full min-w-0 max-w-5xl space-y-6 break-words">
      <Link href="/articles" className="underline">
        All articles
      </Link>
      {article.revisions.map((r, index) => {
        const b = r.body as unknown as BuilderResult["articles"][number] & {
          markdown?: string;
        };
        const source = r.evidence as unknown as
          | BuilderResult["evidence"]
          | { documentId: string; sourcePageNumbers: number[] };
        const evidence = Array.isArray(source)
          ? source
          : [
              {
                id: "",
                documentId: source.documentId,
                documentTitle: source.documentId,
                page: source.sourcePageNumbers[0],
                quote: "",
              },
            ];
        return (
          <details
            key={r.id}
            open={index === 0}
            className="space-y-4 rounded-xl border p-5"
          >
            <summary className="cursor-pointer font-semibold">
              {b.title} · {r.approval ? "Approved" : "Draft"} ·{" "}
              {r.createdAt.toLocaleString()}
            </summary>
            <ArticleSourceStatus context={context} revisionId={r.id} />
            <p>{b.answer}</p>
            {b.markdown && (
              <div className="whitespace-pre-wrap">{b.markdown}</div>
            )}
            <ul className="list-disc pl-5">
              {b.keyPoints?.map((p, i) => (
                <li key={i}>{p.text}</li>
              ))}
            </ul>
            {b.details?.map((d, i) => (
              <section key={i}>
                <h3 className="font-semibold">{d.heading}</h3>
                <p>{d.text}</p>
              </section>
            ))}
            <details>
              <summary>Source evidence</summary>
              {evidence.map((e, i) => (
                <blockquote key={i} className="my-3 border-l-2 pl-3">
                  <Link
                    href={`/documents/${e.documentId}`}
                    className="underline"
                  >
                    {e.documentTitle}, page {e.page}
                  </Link>
                  <p className="text-sm">{e.quote}</p>
                </blockquote>
              ))}
            </details>
            <ArticleVisuals
              revisionId={r.id}
              workspaceId={context.workspaceId}
              approved={!!r.approval}
              evidence={evidence}
            />
            <details>
              <summary>Edit into a new draft</summary>
              <KnowledgeActionForm>
                <input type="hidden" name="action" value="edit" />
                <input type="hidden" name="revisionId" value={r.id} />
                <label className="block">
                  Title
                  <input
                    name="title"
                    defaultValue={b.title}
                    required
                    className="block w-full rounded border bg-background p-2"
                  />
                </label>
                <label className="block">
                  Opening explanation
                  <textarea
                    name="answer"
                    defaultValue={b.answer}
                    required
                    className="block min-h-28 w-full rounded border bg-background p-2"
                  />
                </label>
                {b.keyPoints?.map((p, i) => (
                  <label key={i} className="block">
                    Key point {i + 1}
                    <textarea
                      name={`point-${i}`}
                      defaultValue={p.text}
                      required
                      className="block min-h-20 w-full rounded border bg-background p-2"
                    />
                  </label>
                ))}
                {b.details?.map((d, i) => (
                  <fieldset key={i}>
                    <legend>Detail {i + 1}</legend>
                    <label className="block">
                      Heading
                      <input
                        name={`heading-${i}`}
                        defaultValue={d.heading}
                        required
                        className="block w-full rounded border bg-background p-2"
                      />
                    </label>
                    <label className="block">
                      Explanation
                      <textarea
                        name={`detail-${i}`}
                        defaultValue={d.text}
                        required
                        className="block min-h-28 w-full rounded border bg-background p-2"
                      />
                    </label>
                  </fieldset>
                ))}
                {b.markdown !== undefined && (
                  <label className="block">
                    Legacy article Markdown
                    <textarea
                      name="markdown"
                      defaultValue={b.markdown}
                      className="block min-h-64 w-full rounded border bg-background p-2"
                    />
                  </label>
                )}
                <p className="text-sm text-muted-foreground">
                  Edits retain their source references and require a new review.
                </p>
                <button className="rounded border px-3 py-2">
                  Save new draft
                </button>
              </KnowledgeActionForm>
            </details>
            {!r.approval ? (
              <>
                <KnowledgeActionForm>
                  <input type="hidden" name="action" value="suggest-diagram" />
                  <input type="hidden" name="revisionId" value={r.id} />
                  <button className="rounded border px-3 py-2">
                    Propose a diagram from article evidence
                  </button>
                </KnowledgeActionForm>
                <details>
                  <summary>Add a figure or diagram</summary>
                  <KnowledgeActionForm>
                    <input type="hidden" name="action" value="visual" />
                    <input type="hidden" name="revisionId" value={r.id} />
                    <ArticleVisualFields evidence={evidence} />
                    <button className="rounded border px-3 py-2">
                      Create visual for review
                    </button>
                  </KnowledgeActionForm>
                </details>
                <KnowledgeActionForm>
                  <input type="hidden" name="action" value="approve" />
                  <input type="hidden" name="revisionId" value={r.id} />
                  <button className="rounded border px-3 py-2">
                    Approve in AV-OKF
                  </button>
                </KnowledgeActionForm>
              </>
            ) : knowledgeFeature("export") ? (
              <details>
                <summary>Select this revision for EFB</summary>
                <KnowledgeActionForm>
                  <input type="hidden" name="action" value="select" />
                  <input type="hidden" name="revisionId" value={r.id} />
                  <EfbSelectionFields />
                  <button className="rounded border px-3 py-2">
                    Add to EFB selections
                  </button>
                </KnowledgeActionForm>
              </details>
            ) : null}
          </details>
        );
      })}
    </div>
  );
}
async function ArticleVisuals({
  revisionId,
  workspaceId,
  approved,
  evidence,
}: {
  revisionId: string;
  workspaceId: string;
  approved: boolean;
  evidence: Array<{
    id: string;
    documentId: string;
    documentTitle?: string;
    page?: number;
    quote?: string;
  }>;
}) {
  const visuals = activeArticleVisuals(
    await getPrisma().knowledgeVisual.findMany({
      where: { workspaceId, articleRevisionId: revisionId },
      orderBy: { createdAt: "asc" },
    }),
  );
  return (
    <div className="space-y-4">
      {visuals.map((v) => (
        <figure key={v.id} className="rounded border p-3">
          <div className="overflow-x-auto">
            <a
              href={`/api/article-visuals/${v.id}`}
              target="_blank"
              rel="noreferrer"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/article-visuals/${v.id}`}
                alt={v.altText}
                className={
                  v.kind === "diagram"
                    ? "w-[920px] max-w-none"
                    : "max-h-[600px] w-full object-contain"
                }
              />
            </a>
          </div>
          <figcaption>
            {v.caption} ·{" "}
            {v.kind === "diagram" ? "Conceptual diagram" : "Source figure"} ·{" "}
            {v.reviewedAt ? "Reviewed" : "Needs review"}
          </figcaption>
          {!approved && !v.reviewedAt && (
            <KnowledgeActionForm>
              <input type="hidden" name="action" value="review-visual" />
              <input type="hidden" name="visualId" value={v.id} />
              <button className="rounded border px-3 py-2">
                Confirm visual matches its evidence
              </button>
            </KnowledgeActionForm>
          )}
          {!approved && (
            <details>
              <summary>Edit visual into a new version</summary>
              <KnowledgeActionForm>
                <input type="hidden" name="action" value="visual" />
                <input type="hidden" name="revisionId" value={revisionId} />
                <input type="hidden" name="replacesId" value={v.id} />
                <ArticleVisualFields
                  evidence={evidence}
                  initial={{
                    kind: v.kind,
                    spec: v.spec as Record<string, unknown>,
                    caption: v.caption,
                    altText: v.altText,
                  }}
                />
                <button className="rounded border p-2">
                  Save visual version
                </button>
              </KnowledgeActionForm>
            </details>
          )}
        </figure>
      ))}
    </div>
  );
}

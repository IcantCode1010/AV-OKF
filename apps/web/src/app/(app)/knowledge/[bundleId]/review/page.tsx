import Link from "next/link";
import { ArrowLeft, CircleHelp, Layers3, ShieldCheck } from "lucide-react";
import { notFound } from "next/navigation";

import { BulkTopicReviewList } from "@/components/bulk-topic-review-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import {
  listAwaitingBulkTopicApprovalRuns,
  listBulkReviewTopics,
} from "@/lib/bulk-topic-approval";
import { getDocumentById } from "@/lib/document-backend";
import { getKnowledgeBundle } from "@/lib/knowledge-bundles";
import { listKnowledgeGaps } from "@/lib/knowledge-gaps";

export const dynamic = "force-dynamic";

export default async function BulkTopicReviewPage({ params, searchParams }: {
  params: Promise<{ bundleId: string }>;
  searchParams: Promise<{ documentId?: string; error?: string; view?: string }>;
}) {
  const [{ bundleId }, query, context] = await Promise.all([params, searchParams, requireAuthWorkspaceContext()]);
  const bundle = await getKnowledgeBundle({ bundleId, context });
  if (!bundle) notFound();
  const document = query.documentId
    ? await getDocumentById(query.documentId)
    : undefined;
  if (
    query.documentId &&
    (!document ||
      document.knowledgeBundleId !== bundle.id ||
      (document.workspaceId && document.workspaceId !== context.workspaceId))
  ) {
    notFound();
  }
  const [topics, knowledgeGaps, awaitingRuns] = await Promise.all([
    listBulkReviewTopics({ bundleId, context, documentId: document?.id }),
    listKnowledgeGaps({ context, knowledgeBundleId: bundle.id }),
    listAwaitingBulkTopicApprovalRuns({
      bundleId,
      context,
      documentId: document?.id,
    }),
  ]);
  const backHref = document
    ? `/documents/${encodeURIComponent(document.id)}?panel=processing`
    : `/knowledge/${bundle.id}/browse`;
  const gapsView = query.view === "gaps";
  return (
    <div className="space-y-5">
      <Button asChild size="sm" variant="ghost"><Link href={backHref}><ArrowLeft className="size-4" />{document ? "Back to document" : "Back to bundle"}</Link></Button>
      <header className="flex flex-col gap-3 border-b border-border pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2"><Layers3 className="size-5 text-primary" /><Badge variant="outline">{bundle.name}</Badge></div>
          <h1 className="mt-3 text-2xl font-semibold">{document ? `Review and export ${document.title}` : "Bulk topic approval and export"}</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{document ? `${topics.length} ${topics.length === 1 ? "topic" : "topics"} from this document. Review enriched content, select topics intentionally, then run one preflight before approval.` : "Review enriched content, select topics intentionally, then run one preflight before anything is approved."}</p>
        </div>
      </header>
      {!document ? <div className="flex w-fit gap-1 rounded-md border border-border bg-muted/30 p-1"><Button asChild size="sm" variant={gapsView ? "ghost" : "secondary"}><Link href={`/knowledge/${bundle.id}/review`}>Topics <Badge variant="outline">{topics.length}</Badge></Link></Button><Button asChild size="sm" variant={gapsView ? "secondary" : "ghost"}><Link href={`/knowledge/${bundle.id}/review?view=gaps`}>Knowledge gaps <Badge variant="outline">{knowledgeGaps.length}</Badge></Link></Button></div> : null}
      {query.error ? <div className="border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{query.error}</div> : null}
      {!gapsView && awaitingRuns.length > 0 ? (
        <section className="border border-primary/30 bg-primary/5 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-primary" />
                <p className="text-sm font-medium">A confirmation is ready</p>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {awaitingRuns[0].items.length} selected {awaitingRuns[0].items.length === 1 ? "topic is" : "topics are"} waiting for your final confirmation. Approval has not started.
              </p>
            </div>
            <Button asChild>
              <Link href={`/knowledge/${bundle.id}/review/${awaitingRuns[0].id}`}>
                Review and confirm
              </Link>
            </Button>
          </div>
        </section>
      ) : null}
      {gapsView && !document ? <KnowledgeGapList gaps={knowledgeGaps} /> : <BulkTopicReviewList bundleId={bundle.id} documentId={document?.id} topics={topics} />}
    </div>
  );
}

function KnowledgeGapList({ gaps }: { gaps: Awaited<ReturnType<typeof listKnowledgeGaps>> }) {
  if (!gaps.length) return <div className="border border-dashed border-border p-10 text-center"><CircleHelp className="mx-auto size-5 text-muted-foreground" /><p className="mt-3 text-sm font-medium">No open knowledge gaps</p><p className="mt-1 text-xs text-muted-foreground">Questions appear here when chat cannot find enough supported evidence.</p></div>;
  return <div className="divide-y border border-border">{gaps.map((gap) => <article className="p-4" key={gap.id}><div className="flex flex-wrap items-start justify-between gap-2"><h2 className="text-sm font-medium">{gap.question}</h2><Badge variant="outline">{gap.route}</Badge></div><p className="mt-2 text-xs text-muted-foreground">{gap.reason === "no_matching_evidence" ? "No matching evidence was found." : "Related evidence was found, but it did not answer the question."}</p><p className="mt-2 text-xs text-muted-foreground">Searched: {gap.searchedSources.join(", ") || "No sources recorded"}</p></article>)}</div>;
}

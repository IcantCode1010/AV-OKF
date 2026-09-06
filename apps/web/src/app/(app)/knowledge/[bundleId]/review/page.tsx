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
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { reviewRetrievalTriggerProposalAction } from "./actions";

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
          <h1 className="mt-3 text-2xl font-semibold">{document ? `Topics · ${document.title}` : "Topic drafting and review"}</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{document ? `${topics.length} ${topics.length === 1 ? "topic" : "topics"} from this document. Select topics for enrichment first, then review and approve completed drafts.` : "Manage topics across this collection: enrich selected source topics, then review and approve completed drafts."}</p>
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
      {gapsView && !document ? <KnowledgeGapList bundleId={bundle.id} gaps={knowledgeGaps} /> : <BulkTopicReviewList bundleId={bundle.id} documentId={document?.id} topics={topics} />}
    </div>
  );
}

function KnowledgeGapList({ bundleId, gaps }: { bundleId: string; gaps: Awaited<ReturnType<typeof listKnowledgeGaps>> }) {
  if (!gaps.length) return <div className="border border-dashed border-border p-10 text-center"><CircleHelp className="mx-auto size-5 text-muted-foreground" /><p className="mt-3 text-sm font-medium">No open knowledge gaps</p><p className="mt-1 text-xs text-muted-foreground">Questions appear here when chat cannot find enough supported evidence.</p></div>;
  return (
    <div className="divide-y border border-border">
      {gaps.map((gap) => (
        <article className="space-y-3 p-4" key={gap.id}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h2 className="text-sm font-medium">{gap.question}</h2>
            <Badge variant="outline">{gap.route}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {gap.reason === "no_matching_evidence"
              ? "No matching evidence was found."
              : "Related evidence was found, but it did not answer the question."}
          </p>
          <p className="text-xs text-muted-foreground">
            Searched: {gap.searchedSources.join(", ") || "No sources recorded"}
          </p>
          {gap.retrievalTriggerProposals.length > 0 ? (
            <div className="space-y-2 border-t border-border pt-3">
              <p className="text-xs font-medium uppercase text-muted-foreground">
                Search alias proposals
              </p>
              {gap.retrievalTriggerProposals.map((proposal) => (
                <div
                  className="grid gap-3 border border-border p-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end"
                  key={proposal.id}
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium">{proposal.targetTitle}</p>
                      <Badge variant={proposal.status === "approved" ? "secondary" : "outline"}>
                        {proposal.status}
                      </Badge>
                    </div>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">
                      {proposal.targetFilePath}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">{proposal.matchReason}</p>
                  </div>
                  {proposal.status === "pending" ? (
                    <div className="flex flex-col gap-2 sm:min-w-80">
                      <form action={reviewRetrievalTriggerProposalAction} className="grid gap-2">
                        <input name="knowledgeBundleId" type="hidden" value={bundleId} />
                        <input name="proposalId" type="hidden" value={proposal.id} />
                        <input name="decision" type="hidden" value="approve" />
                        <label className="grid gap-1 text-xs">
                          Search aliases
                          <input
                            className="h-9 border border-input bg-background px-3 text-sm"
                            defaultValue={proposal.suggestedTerms.join(", ")}
                            name="terms"
                          />
                        </label>
                        <PendingSubmitButton pendingLabel="Approving...">
                          Approve aliases
                        </PendingSubmitButton>
                      </form>
                      <form action={reviewRetrievalTriggerProposalAction}>
                        <input name="knowledgeBundleId" type="hidden" value={bundleId} />
                        <input name="proposalId" type="hidden" value={proposal.id} />
                        <input name="decision" type="hidden" value="reject" />
                        <PendingSubmitButton
                          className="w-full"
                          pendingLabel="Rejecting..."
                          variant="outline"
                        >
                          Reject
                        </PendingSubmitButton>
                      </form>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {proposal.status === "approved"
                        ? `Active aliases: ${proposal.approvedTerms.join(", ")}`
                        : "This proposal will not affect retrieval."}
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="border-t border-border pt-3 text-xs text-muted-foreground">
              No safe concept near-miss was available, so no search alias was proposed.
            </p>
          )}
        </article>
      ))}
    </div>
  );
}

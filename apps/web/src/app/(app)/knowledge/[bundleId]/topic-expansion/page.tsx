import Link from "next/link";
import { CheckCircle2, CircleAlert, LoaderCircle, Search, Sparkles } from "lucide-react";
import { notFound } from "next/navigation";

import { PendingSubmitButton } from "@/components/pending-submit-button";
import { TopicExpansionPoller } from "@/components/topic-expansion-poller";
import { TopicExpansionSelectionSubmit } from "@/components/topic-expansion-selection-submit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import { getKnowledgeBundle } from "@/lib/knowledge-bundles";
import { listTopicExpansionState } from "@/lib/topic-expansion";
import {
  cancelTopicExpansionEnrichmentAction,
  cancelTopicExpansionRunAction,
  confirmTopicExpansionEnrichmentAction,
  confirmTopicExpansionRunAction,
  prepareTopicExpansionEnrichmentAction,
  prepareTopicExpansionRunAction,
  rejectTopicExpansionProposalAction,
  retryTopicExpansionEnrichmentAction,
  retryTopicExpansionRunAction,
} from "./actions";

export const dynamic = "force-dynamic";

const VIEWS = ["proposed", "enriching", "enriched", "rejected", "stale", "failed"] as const;

export default async function TopicExpansionPage({ params, searchParams }: {
  params: Promise<{ bundleId: string }>;
  searchParams: Promise<{ batch?: string; view?: string }>;
}) {
  const [{ bundleId }, query, context] = await Promise.all([params, searchParams, requireAuthWorkspaceContext()]);
  const bundle = await getKnowledgeBundle({ bundleId, context });
  if (!bundle) notFound();
  const state = await listTopicExpansionState({ context, knowledgeBundleId: bundle.id });
  const view = VIEWS.includes(query.view as typeof VIEWS[number]) ? query.view as typeof VIEWS[number] : "proposed";
  const visible = state.proposals.filter((proposal) => proposal.status === view || (view === "enriching" && ["selected", "enriching"].includes(proposal.status)));
  const selectedBatch = query.batch
    ? state.batches.find(({ id }) => id === query.batch)
    : state.batches.find(({ status }) => status === "awaiting_confirmation");

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <TopicExpansionPoller active={state.active} bundleId={bundle.id} fingerprint={state.fingerprint} />
      <header className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2"><Sparkles className="size-5 text-primary" /><Badge variant="outline">{bundle.name}</Badge></div>
          <h1 className="mt-3 text-2xl font-semibold">Topic expansion</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">Analyze approved knowledge for grounded subjects that deserve their own topic. Every proposal remains unapproved until it completes normal enrichment and review.</p>
        </div>
        <Badge variant="secondary">Maximum 20 proposals per run</Badge>
      </header>

      <section className="grid gap-3 border-y border-border py-4 sm:grid-cols-3">
        <Metric label="Approved concepts" value={state.approvedConceptCount} />
        <Metric label="Current proposals" value={state.proposals.filter(({ status }) => status === "proposed").length} />
        <Metric label="Enriched additions" value={state.proposals.filter(({ status }) => status === "enriched").length} />
      </section>

      <RunPanel bundleId={bundle.id} run={state.latestRun} />
      {selectedBatch?.status === "awaiting_confirmation" ? <EnrichmentConfirmation batch={selectedBatch} bundleId={bundle.id} /> : null}

      <nav aria-label="Topic expansion views" className="flex flex-wrap gap-1 border border-border bg-muted/30 p-1">
        {VIEWS.map((item) => (
          <Button asChild key={item} size="sm" variant={view === item ? "secondary" : "ghost"}>
            <Link href={`/knowledge/${bundle.id}/topic-expansion?view=${item}`}>{formatStatus(item)} <Badge variant="outline">{state.proposals.filter((proposal) => proposal.status === item || (item === "enriching" && proposal.status === "selected")).length}</Badge></Link>
          </Button>
        ))}
      </nav>

      {view === "proposed" ? (
        <form action={prepareTopicExpansionEnrichmentAction} className="space-y-4">
          <input name="knowledgeBundleId" type="hidden" value={bundle.id} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">Select only the proposals you want to pay to enrich. Selection does not start a provider call.</p>
            <TopicExpansionSelectionSubmit />
          </div>
          <ProposalGrid bundleId={bundle.id} proposals={visible} selectable />
        </form>
      ) : <ProposalGrid bundleId={bundle.id} proposals={visible} />}

      {visible.length === 0 ? <div className="border border-dashed border-border p-10 text-center"><Search className="mx-auto size-5 text-muted-foreground" /><p className="mt-3 text-sm font-medium">No {formatStatus(view)} proposals</p><p className="mt-1 text-xs text-muted-foreground">Run expansion after approved bundle content changes to discover another bounded set.</p></div> : null}

      <PreviousRuns bundleId={bundle.id} runs={state.runs} />
    </div>
  );
}

function RunPanel({ bundleId, run }: { bundleId: string; run: Awaited<ReturnType<typeof listTopicExpansionState>>["latestRun"] }) {
  if (!run) return <section className="flex flex-col gap-4 border border-border p-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-medium">Analyze approved knowledge</h2><p className="mt-1 text-sm text-muted-foreground">Prepare a bounded estimate from the current approved corpus. No LLM call occurs yet.</p></div><form action={prepareTopicExpansionRunAction}><input name="knowledgeBundleId" type="hidden" value={bundleId} /><PendingSubmitButton pendingLabel="Preparing estimate...">Prepare expansion</PendingSubmitButton></form></section>;
  if (run.status === "awaiting_confirmation") return <section className="border border-primary/30 bg-primary/5 p-4"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-semibold uppercase text-primary">Ready to run</p><h2 className="mt-1 font-medium">{run.approvedConceptCount} approved concepts</h2><p className="mt-1 text-sm text-muted-foreground">Estimated {run.estimatedCalls} bounded model calls and {run.estimatedInputTokens.toLocaleString()} input tokens. The run stops after the finite corpus and exposes at most 20 proposals.</p></div><div className="flex gap-2"><form action={cancelTopicExpansionRunAction}><input name="knowledgeBundleId" type="hidden" value={bundleId} /><input name="runId" type="hidden" value={run.id} /><PendingSubmitButton pendingLabel="Cancelling..." variant="outline">Cancel</PendingSubmitButton></form><form action={confirmTopicExpansionRunAction}><input name="knowledgeBundleId" type="hidden" value={bundleId} /><input name="runId" type="hidden" value={run.id} /><PendingSubmitButton pendingLabel="Queuing expansion...">Confirm and run</PendingSubmitButton></form></div></div></section>;
  if (["queued", "running", "cancellation_requested"].includes(run.status)) return <section aria-live="polite" className="flex flex-col gap-3 border border-sky-500/30 bg-sky-500/5 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-3"><LoaderCircle className="size-5 animate-spin motion-reduce:animate-none text-sky-600" /><div><h2 className="font-medium">Topic expansion is {formatStatus(run.status)}</h2><p className="text-sm text-muted-foreground">Analyzed {run.analyzedConceptCount} of {run.approvedConceptCount} approved concepts. This page updates automatically.</p></div></div>{run.status !== "cancellation_requested" ? <form action={cancelTopicExpansionRunAction}><input name="knowledgeBundleId" type="hidden" value={bundleId} /><input name="runId" type="hidden" value={run.id} /><PendingSubmitButton pendingLabel="Stopping..." size="sm" variant="outline">Cancel run</PendingSubmitButton></form> : null}</section>;
  if (["awaiting_provider", "failed"].includes(run.status)) return <section className="flex flex-col gap-4 border border-destructive/30 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex items-center gap-2"><CircleAlert className="size-4 text-destructive" /><h2 className="font-medium">Expansion needs attention</h2></div><p className="mt-1 text-sm text-muted-foreground">{safeError(run.errorCode)}</p></div><div className="flex gap-2">{run.status === "awaiting_provider" ? <Button asChild variant="outline"><Link href="/settings">Configure AI provider</Link></Button> : null}<form action={retryTopicExpansionRunAction}><input name="knowledgeBundleId" type="hidden" value={bundleId} /><input name="runId" type="hidden" value={run.id} /><PendingSubmitButton pendingLabel="Retrying...">Retry expansion</PendingSubmitButton></form></div></section>;
  if (run.status === "cancelled") return <section className="flex flex-col gap-3 border border-border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-medium">Expansion cancelled</h2><p className="mt-1 text-sm text-muted-foreground">No additional concepts were proposed after cancellation. Prepare expansion to restart against the current corpus.</p></div><form action={prepareTopicExpansionRunAction}><input name="knowledgeBundleId" type="hidden" value={bundleId} /><PendingSubmitButton pendingLabel="Preparing estimate...">Prepare expansion</PendingSubmitButton></form></section>;
  return <section className="flex items-center gap-3 border border-emerald-500/30 bg-emerald-500/5 p-4"><CheckCircle2 className="size-5 text-emerald-600" /><div><h2 className="font-medium">Expansion complete</h2><p className="text-sm text-muted-foreground">Analyzed {run.analyzedConceptCount} concepts, validated {run.candidateCount} candidates, presented {run.proposedCount}, and filtered {run.filteredCount}.</p></div></section>;
}

function EnrichmentConfirmation({ batch, bundleId }: { batch: Awaited<ReturnType<typeof listTopicExpansionState>>["batches"][number]; bundleId: string }) {
  return <section className="border border-primary/30 bg-primary/5 p-4"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-semibold uppercase text-primary">Enrichment confirmation</p><h2 className="mt-1 font-medium">{batch.items.length} selected topics</h2><p className="mt-1 text-sm text-muted-foreground">Estimated {batch.estimatedInputTokens.toLocaleString()} input tokens. Confirmation creates unapproved topics and queues independent enrichment jobs.</p></div><div className="flex gap-2"><form action={cancelTopicExpansionEnrichmentAction}><input name="batchId" type="hidden" value={batch.id} /><input name="knowledgeBundleId" type="hidden" value={bundleId} /><PendingSubmitButton pendingLabel="Cancelling..." variant="outline">Cancel</PendingSubmitButton></form><form action={confirmTopicExpansionEnrichmentAction}><input name="batchId" type="hidden" value={batch.id} /><input name="knowledgeBundleId" type="hidden" value={bundleId} /><PendingSubmitButton pendingLabel="Starting enrichment...">Confirm and enrich</PendingSubmitButton></form></div></div></section>;
}

function ProposalGrid({ bundleId, proposals, selectable = false }: { bundleId: string; proposals: Awaited<ReturnType<typeof listTopicExpansionState>>["proposals"]; selectable?: boolean }) {
  return <div className="grid gap-4 xl:grid-cols-2">{proposals.map((proposal) => {
    const job = proposal.enrichmentJobs[0];
    return <article className="space-y-4 border border-border p-4" key={proposal.id}><div className="flex items-start gap-3">{selectable ? <input aria-label={`Select ${proposal.title}`} className="mt-1 size-4" name="proposalIds" type="checkbox" value={proposal.id} /> : null}<div className="min-w-0 flex-1"><div className="flex flex-wrap gap-2"><Badge>{proposal.topicType}</Badge><Badge variant="outline">{Math.round(proposal.confidence * 100)}% confidence</Badge><Badge variant="outline">{formatStatus(proposal.status)}</Badge></div><h2 className="mt-3 font-medium">{proposal.title}</h2><p className="mt-2 text-sm text-muted-foreground">{proposal.summary}</p></div></div><div className="border-l-2 border-primary/40 pl-3"><p className="text-xs font-medium uppercase text-muted-foreground">Why this is a separate topic</p><p className="mt-1 text-sm">{proposal.rationale}</p></div><details className="border-t border-border pt-3"><summary className="cursor-pointer text-sm font-medium">Grounded evidence ({proposal.evidence.length})</summary><div className="mt-3 space-y-3">{proposal.evidence.map((evidence) => <blockquote className="border-l border-border pl-3 text-sm" key={evidence.id}><p>&ldquo;{evidence.evidenceQuote}&rdquo;</p><footer className="mt-1 text-xs text-muted-foreground">{evidence.sourceTopic.title} · {evidence.document.title} · pages {formatPages(evidence.sourcePages)}</footer></blockquote>)}</div></details><div className="flex flex-wrap gap-2">{proposal.status === "proposed" ? <form action={rejectTopicExpansionProposalAction}><input name="knowledgeBundleId" type="hidden" value={bundleId} /><input name="proposalId" type="hidden" value={proposal.id} /><input name="decision" type="hidden" value="reject" /><PendingSubmitButton pendingLabel="Rejecting..." size="sm" variant="outline">Reject proposal</PendingSubmitButton></form> : null}{proposal.status === "rejected" ? <form action={rejectTopicExpansionProposalAction}><input name="knowledgeBundleId" type="hidden" value={bundleId} /><input name="proposalId" type="hidden" value={proposal.id} /><input name="decision" type="hidden" value="restore" /><PendingSubmitButton pendingLabel="Restoring..." size="sm" variant="outline">Restore proposal</PendingSubmitButton></form> : null}{proposal.status === "enriched" && proposal.promotedTopicId ? <Button asChild size="sm"><Link href={`/knowledge/${bundleId}/review`}>Open in Review</Link></Button> : null}{proposal.status === "failed" && job ? <form action={retryTopicExpansionEnrichmentAction}><input name="knowledgeBundleId" type="hidden" value={bundleId} /><input name="jobId" type="hidden" value={job.id} /><PendingSubmitButton pendingLabel="Retrying..." size="sm">Retry enrichment</PendingSubmitButton></form> : null}</div></article>;
  })}</div>;
}

function PreviousRuns({ bundleId, runs }: { bundleId: string; runs: Awaited<ReturnType<typeof listTopicExpansionState>>["runs"] }) {
  if (runs.length === 0) return null;
  return <section className="border-t border-border pt-5"><h2 className="font-medium">Previous runs</h2><div className="mt-3 divide-y divide-border border-y border-border">{runs.map((run) => <div className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between" key={run.id}><div><div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{formatStatus(run.status)}</Badge><span className="text-sm font-medium">{run.approvedConceptCount} approved concepts</span></div><p className="mt-1 text-xs text-muted-foreground">{run.proposedCount} proposed · {run.filteredCount} filtered · {run.createdAt.toLocaleString()}</p></div>{["awaiting_provider", "failed"].includes(run.status) ? <form action={retryTopicExpansionRunAction}><input name="knowledgeBundleId" type="hidden" value={bundleId} /><input name="runId" type="hidden" value={run.id} /><PendingSubmitButton pendingLabel="Retrying..." size="sm" variant="outline">Retry</PendingSubmitButton></form> : null}</div>)}</div></section>;
}

function Metric({ label, value }: { label: string; value: number }) { return <div><p className="text-2xl font-semibold">{value}</p><p className="text-xs text-muted-foreground">{label}</p></div>; }
function formatStatus(value: string) { return value.replaceAll("_", " "); }
function safeError(value: string | null) { return value ? value.replaceAll("_", " ") : "The provider or evidence validator failed. Retry keeps the run bounded and idempotent."; }
function formatPages(pages: number[]) { return [...new Set(pages)].sort((a, b) => a - b).join(", "); }

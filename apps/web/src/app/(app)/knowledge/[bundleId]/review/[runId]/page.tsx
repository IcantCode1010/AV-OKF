import Link from "next/link";
import { ArrowLeft, CheckCircle2, CircleAlert, Clock3 } from "lucide-react";
import { notFound } from "next/navigation";

import { retryBulkTopicApprovalAction } from "@/app/(app)/knowledge/bulk-actions";
import { BulkRunConfirmationPanel } from "@/components/bulk-run-confirmation-panel";
import { BulkRunPoller } from "@/components/bulk-run-poller";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import {
  bulkApprovalSourcePageNumbers,
  buildBulkTopicApprovalStatusSnapshot,
  findPageOverlapErrors,
  getBulkTopicApprovalRun,
  isBulkTopicApprovalRunConfirmable,
  isRetryableBulkFailure,
  summarizeBulkTopicApprovalProgress,
} from "@/lib/bulk-topic-approval";

export const dynamic = "force-dynamic";

export default async function BulkTopicApprovalRunPage({ params, searchParams }: { params: Promise<{ bundleId: string; runId: string }>; searchParams: Promise<{ error?: string }> }) {
  const [{ bundleId, runId }, query, context] = await Promise.all([params, searchParams, requireAuthWorkspaceContext()]);
  const run = await getBulkTopicApprovalRun({ context, runId });
  if (!run || run.knowledgeBundleId !== bundleId) notFound();
  const statusSnapshot = buildBulkTopicApprovalStatusSnapshot(run);
  const progress = summarizeBulkTopicApprovalProgress(run.items);
  const confirmationIsCurrent = isBulkTopicApprovalRunConfirmable(run);
  const retryableCount = run.items.filter((item) => item.status === "failed" && isRetryableBulkFailure(item.failureCode)).length;
  const sharedPagePairCount = findPageOverlapErrors(
    run.items.map((item) => ({
      documentId: item.documentId,
      id: item.topicId,
      sourcePageNumbers: bulkApprovalSourcePageNumbers(item.topic),
    })),
    [],
  ).length;
  return (
    <div className="space-y-5">
      <BulkRunPoller
        active={statusSnapshot.active}
        fingerprint={statusSnapshot.fingerprint}
        runId={run.id}
      />
      <Button asChild size="sm" variant="ghost"><Link href={`/knowledge/${bundleId}/review`}><ArrowLeft className="size-4" />Back to topic review</Link></Button>
      <header className="border-b border-border pb-5">
        <div className="flex flex-wrap items-center gap-2"><Badge variant="secondary">{run.knowledgeBundle.name}</Badge><Badge className="capitalize" variant="outline">{run.mode}</Badge><Badge className="capitalize" variant="outline">{run.status.replaceAll("_", " ")}</Badge></div>
        <h1 className="mt-3 text-2xl font-semibold">{run.mode === "automated" ? "Automatic approval run" : "Bulk approval run"}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{run.items.length} selected topics · {run.estimatedEmbeddingTokens.toLocaleString()} estimated embedding tokens</p>
      </header>
      {query.error ? <div className="border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-100">{query.error}</div> : null}

      {run.status === "awaiting_confirmation" && confirmationIsCurrent ? (
        <BulkRunConfirmationPanel
          bundleId={bundleId}
          itemCount={run.items.length}
          runId={run.id}
          sharedPagePairCount={sharedPagePairCount}
        />
      ) : null}

      {run.status === "awaiting_confirmation" && !confirmationIsCurrent ? (
        <section className="border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-800 dark:text-amber-100">
          <h2 className="font-medium">This confirmation is no longer current</h2>
          <p className="mt-1">
            One or more selected topics changed or were approved by another batch. Return to topic review to see their current status and prepare a new selection if needed.
          </p>
          <Button asChild className="mt-3" size="sm" variant="outline">
            <Link href={`/knowledge/${bundleId}/review`}>Return to topic review</Link>
          </Button>
        </section>
      ) : null}

      {run.status !== "awaiting_confirmation" ? (
        <section className="border border-border bg-muted/20 p-4" aria-live="polite">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-medium">Approval and export progress</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {progress.completed} of {progress.total} topics finished
                {progress.activeTitle ? ` · Working on ${progress.activeTitle}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="outline">{progress.succeeded} approved</Badge>
              <Badge variant="outline">{progress.inProgress} processing</Badge>
              <Badge variant="outline">{progress.pending} waiting</Badge>
              {progress.failed > 0 ? <Badge variant="destructive">{progress.failed} failed</Badge> : null}
            </div>
          </div>
          <div
            aria-label={`${progress.completed} of ${progress.total} topics finished`}
            aria-valuemax={progress.total}
            aria-valuemin={0}
            aria-valuenow={progress.completed}
            className="mt-4 h-2 overflow-hidden bg-muted"
            role="progressbar"
          >
            <div
              className="h-full bg-primary transition-[width] motion-reduce:transition-none"
              style={{ width: `${progress.total === 0 ? 0 : Math.round((progress.completed / progress.total) * 100)}%` }}
            />
          </div>
          {statusSnapshot.active ? <p className="mt-2 text-xs text-muted-foreground">This page updates automatically as each topic finishes.</p> : null}
        </section>
      ) : null}

      <div className="space-y-3">
        {run.items.map((item) => (
          <article className="grid gap-3 border border-border bg-card p-4 md:grid-cols-[1fr_auto]" key={item.id}>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                {item.status === "succeeded" ? <CheckCircle2 className="size-4 text-emerald-500" /> : item.status === "failed" ? <CircleAlert className="size-4 text-red-400" /> : <Clock3 className="size-4 text-amber-500" />}
                <Badge className="capitalize" variant="outline">{item.status}</Badge>
                <Badge variant="outline">{item.topic.confidence} confidence</Badge>
                <Badge variant="outline">pages {item.topic.pageStart}-{item.topic.pageEnd}</Badge>
              </div>
              <h2 className="mt-3 font-medium">{item.topic.enrichedTitle ?? item.topic.title}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{item.topic.enrichedSummary ?? item.topic.summary}</p>
              <p className="mt-1 text-sm text-muted-foreground">{item.document.title}</p>
              {item.exportedFilePath ? <p className="mt-2 font-mono text-xs text-muted-foreground">{item.exportedFilePath}</p> : null}
              {item.failureMessage ? <p className="mt-2 text-sm text-red-300">{formatFailure(item.failureMessage)}</p> : null}
            </div>
            <Button asChild size="sm" variant="outline"><Link href={`/documents/${item.documentId}?panel=topics&topic=${item.topicId}`}>Open topic</Link></Button>
          </article>
        ))}
      </div>

      {retryableCount > 0 && !statusSnapshot.active ? (
        <form action={retryBulkTopicApprovalAction}><input name="knowledgeBundleId" type="hidden" value={bundleId} /><input name="runId" type="hidden" value={run.id} /><PendingSubmitButton pendingLabel="Queueing retry...">Retry {retryableCount} failed {retryableCount === 1 ? "topic" : "topics"}</PendingSubmitButton></form>
      ) : null}
    </div>
  );
}

function formatFailure(value: string) {
  if (value === "bulk_topic_already_processed") return "Already processed by another approval run.";
  return value.replaceAll("_", " ");
}

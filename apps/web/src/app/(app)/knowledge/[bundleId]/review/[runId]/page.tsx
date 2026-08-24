import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";

import { retryBulkTopicApprovalAction } from "@/app/(app)/knowledge/bulk-actions";
import { BulkRunConfirmationPanel } from "@/components/bulk-run-confirmation-panel";
import { BulkRunLiveProgress } from "@/components/bulk-run-live-progress";
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
} from "@/lib/bulk-topic-approval";

export const dynamic = "force-dynamic";

export default async function BulkTopicApprovalRunPage({ params, searchParams }: { params: Promise<{ bundleId: string; runId: string }>; searchParams: Promise<{ error?: string }> }) {
  const [{ bundleId, runId }, query, context] = await Promise.all([params, searchParams, requireAuthWorkspaceContext()]);
  const run = await getBulkTopicApprovalRun({ context, runId });
  if (!run || run.knowledgeBundleId !== bundleId) notFound();
  const statusSnapshot = buildBulkTopicApprovalStatusSnapshot(run);
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
        <BulkRunLiveProgress initialItems={run.items.map((item) => ({ confidence: item.topic.confidence, documentId: item.documentId, documentTitle: item.document.title, exportedFilePath: item.exportedFilePath, failureMessage: item.failureMessage, id: item.id, pageEnd: item.topic.pageEnd, pageStart: item.topic.pageStart, status: item.status, summary: item.topic.enrichedSummary ?? item.topic.summary, title: item.topic.enrichedTitle ?? item.topic.title, topicId: item.topicId }))} initialSnapshot={statusSnapshot} runId={run.id} />
      ) : null}

      {retryableCount > 0 && !statusSnapshot.active ? (
        <form action={retryBulkTopicApprovalAction}><input name="knowledgeBundleId" type="hidden" value={bundleId} /><input name="runId" type="hidden" value={run.id} /><PendingSubmitButton pendingLabel="Queueing retry...">Retry {retryableCount} failed {retryableCount === 1 ? "topic" : "topics"}</PendingSubmitButton></form>
      ) : null}
    </div>
  );
}

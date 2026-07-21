import Link from "next/link";
import { ArrowLeft, CheckCircle2, CircleAlert, Clock3 } from "lucide-react";
import { notFound } from "next/navigation";

import { confirmBulkTopicApprovalAction, retryBulkTopicApprovalAction } from "@/app/(app)/knowledge/bulk-actions";
import { BulkRunPoller } from "@/components/bulk-run-poller";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import { getBulkTopicApprovalRun, isRetryableBulkFailure } from "@/lib/bulk-topic-approval";

export const dynamic = "force-dynamic";

export default async function BulkTopicApprovalRunPage({ params, searchParams }: { params: Promise<{ bundleId: string; runId: string }>; searchParams: Promise<{ error?: string }> }) {
  const [{ bundleId, runId }, query, context] = await Promise.all([params, searchParams, requireAuthWorkspaceContext()]);
  const run = await getBulkTopicApprovalRun({ context, runId });
  if (!run || run.knowledgeBundleId !== bundleId) notFound();
  const active = run.status === "queued" || run.status === "running";
  const retryableCount = run.items.filter((item) => item.status === "failed" && isRetryableBulkFailure(item.failureCode)).length;
  return (
    <div className="space-y-5">
      <BulkRunPoller active={active} />
      <Button asChild size="sm" variant="ghost"><Link href={`/knowledge/${bundleId}/review`}><ArrowLeft className="size-4" />Back to topic review</Link></Button>
      <header className="border-b border-border pb-5">
        <div className="flex flex-wrap items-center gap-2"><Badge variant="secondary">{run.knowledgeBundle.name}</Badge><Badge className="capitalize" variant="outline">{run.mode}</Badge><Badge className="capitalize" variant="outline">{run.status.replaceAll("_", " ")}</Badge></div>
        <h1 className="mt-3 text-2xl font-semibold">{run.mode === "automated" ? "Automatic approval run" : "Bulk approval run"}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{run.items.length} selected topics · {run.estimatedEmbeddingTokens.toLocaleString()} estimated embedding tokens</p>
      </header>
      {query.error ? <div className="border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-100">{query.error}</div> : null}

      {run.status === "awaiting_confirmation" ? (
        <div className="border border-amber-400/30 bg-amber-400/5 p-4">
          <h2 className="font-medium">Confirm approval and export</h2>
          <p className="mt-2 text-sm text-muted-foreground">Enrichment is already complete. The estimate covers only the future semantic lookup embeddings. Each topic succeeds or fails independently.</p>
          <form action={confirmBulkTopicApprovalAction} className="mt-4"><input name="knowledgeBundleId" type="hidden" value={bundleId} /><input name="runId" type="hidden" value={run.id} /><PendingSubmitButton pendingLabel="Queueing batch...">Confirm and run batch</PendingSubmitButton></form>
        </div>
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

      {retryableCount > 0 && !active ? (
        <form action={retryBulkTopicApprovalAction}><input name="knowledgeBundleId" type="hidden" value={bundleId} /><input name="runId" type="hidden" value={run.id} /><PendingSubmitButton pendingLabel="Queueing retry...">Retry {retryableCount} failed {retryableCount === 1 ? "topic" : "topics"}</PendingSubmitButton></form>
      ) : null}
    </div>
  );
}

function formatFailure(value: string) {
  if (value === "bulk_topic_already_processed") return "Already processed by another approval run.";
  return value.replaceAll("_", " ");
}

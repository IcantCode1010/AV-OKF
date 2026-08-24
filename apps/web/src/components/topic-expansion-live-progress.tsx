"use client";

import { CheckCircle2, Clock3, LoaderCircle } from "lucide-react";

import { cancelTopicExpansionRunAction } from "@/app/(app)/knowledge/[bundleId]/topic-expansion/actions";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { Badge } from "@/components/ui/badge";
import { useOperationProgress, useOperationTerminalRefresh } from "@/components/use-operation-progress";
import type { OperationProgressSnapshot } from "@/lib/operation-progress";
import type { TopicExpansionProgressData } from "@/lib/topic-expansion";

export function TopicExpansionLiveProgress({ bundleId, initialSnapshot }: { bundleId: string; initialSnapshot: OperationProgressSnapshot<TopicExpansionProgressData | null> }) {
  const refreshTerminal = useOperationTerminalRefresh();
  const { connected, snapshot } = useOperationProgress({
    initialSnapshot,
    onTerminal: refreshTerminal,
    url: `/api/knowledge-bundles/${encodeURIComponent(bundleId)}/topic-expansion/status`,
  });
  const data = snapshot.data;
  const operation = snapshot.operations[0];
  if (!data || !operation) return null;
  const finished = data.completed + data.failed;
  const percent = data.total > 0 ? Math.round((finished / data.total) * 100) : 0;
  return (
    <section aria-live="polite" className="space-y-4 border border-sky-500/30 bg-sky-500/5 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <LoaderCircle className="mt-0.5 size-5 shrink-0 animate-spin text-sky-600 motion-reduce:animate-none" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-medium">{stageLabel(operation.stage, data.current?.title)}</h2>
              <Badge variant="outline">{connected ? "Live" : "Reconnecting"}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{finished} of {data.total} topics finished · {data.queued} queued · {data.failed} failed</p>
          </div>
        </div>
        {data.status !== "cancellation_requested" ? <form action={cancelTopicExpansionRunAction}><input name="knowledgeBundleId" type="hidden" value={bundleId} /><input name="runId" type="hidden" value={data.runId} /><PendingSubmitButton pendingLabel="Stopping..." size="sm" variant="outline">Cancel run</PendingSubmitButton></form> : null}
      </div>
      <div aria-label={`${finished} of ${data.total} topics finished`} aria-valuemax={data.total} aria-valuemin={0} aria-valuenow={finished} className="h-2 overflow-hidden bg-muted" role="progressbar"><div className="h-full bg-sky-500 transition-[width] motion-reduce:transition-none" style={{ width: `${percent}%` }} /></div>
      {data.current ? <div className="grid gap-3 border-y border-sky-500/20 py-3 sm:grid-cols-4"><Metric label="Current topic" value={data.current.title} /><Metric label="Research round" value={`${data.current.currentRound || 1} of 3`} /><Metric label="Searches" value={String(data.current.searchQueryCount)} /><Metric label="Grounded chunks" value={String(data.current.evidenceChunkCount)} /></div> : null}
      <div className="grid gap-4 md:grid-cols-2">
        <div><p className="text-xs font-semibold uppercase text-muted-foreground">Recently finished</p><div className="mt-2 space-y-2">{data.recent.length > 0 ? data.recent.map((item) => <div className="flex items-start gap-2 text-sm" key={item.id}><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" /><span><span className="font-medium">{item.title}</span><span className="block text-xs text-muted-foreground">{item.completedRounds} rounds · {item.searchQueryCount} searches · {item.evidenceChunkCount} chunks · {item.candidateCount} candidates</span></span></div>) : <p className="text-sm text-muted-foreground">No topic has finished yet.</p>}</div></div>
        <div><p className="text-xs font-semibold uppercase text-muted-foreground">Up next</p><div className="mt-2 space-y-2">{data.next.length > 0 ? data.next.map((item) => <div className="flex items-center gap-2 text-sm" key={item.id}><Clock3 className="size-4 shrink-0 text-muted-foreground" /><span className="truncate">{item.title}</span></div>) : <p className="text-sm text-muted-foreground">Waiting for consolidation.</p>}</div></div>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="min-w-0"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 truncate text-sm font-medium">{value}</p></div>; }
function stageLabel(stage: string, title?: string) {
  const labels: Record<string, string> = { analyzing_evidence: "Analyzing grounded evidence", consolidating_discoveries: "Consolidating discoveries", following_terminology: "Following grounded terminology", planning_retrieval: "Planning retrieval", queued: "Queuing topic research", reranking_evidence: "Reranking evidence", searching_sources: "Searching approved sources" };
  return `${labels[stage] ?? stage.replaceAll("_", " ")}${title ? ` · ${title}` : ""}`;
}

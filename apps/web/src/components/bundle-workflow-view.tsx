"use client";

import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  Check,
  Circle,
  Clock3,
  LoaderCircle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  BundleWorkflowSnapshot,
  BundleWorkflowStage,
  BundleWorkflowStatus,
} from "@/lib/bundle-workflow";
import type { OperationProgressSnapshot } from "@/lib/operation-progress";
import { useOperationProgress } from "@/components/use-operation-progress";
import { cn } from "@/lib/utils";

export function BundleWorkflowView({
  bundleId,
  initialSnapshot,
}: {
  bundleId: string;
  initialSnapshot: OperationProgressSnapshot<BundleWorkflowSnapshot>;
}) {
  const { connected, snapshot: progressSnapshot } = useOperationProgress({ initialSnapshot, url: `/api/knowledge-bundles/${encodeURIComponent(bundleId)}/workflow/status` });
  const snapshot = progressSnapshot.data;

  return (
    <div className="space-y-8">
      {!connected ? <p className="text-xs text-amber-600" role="status">Live progress is reconnecting. The last confirmed state remains visible.</p> : null}
      {snapshot.nextAction ? (
        <section className="flex flex-col gap-4 border-y border-primary/30 bg-primary/5 px-4 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase text-primary">Next action</p>
            <p className="mt-1 text-base font-medium">{snapshot.nextAction.label}</p>
            <p className="mt-1 text-sm text-muted-foreground">{snapshot.nextAction.detail}</p>
          </div>
          <Button asChild className="shrink-0"><Link href={snapshot.nextAction.href}>{snapshot.nextAction.label}<ArrowRight /></Link></Button>
        </section>
      ) : (
        <section className="border-y border-emerald-500/30 bg-emerald-500/5 px-4 py-5">
          <p className="text-xs font-semibold uppercase text-emerald-600 dark:text-emerald-400">Workflow complete</p>
          <p className="mt-1 text-sm text-muted-foreground">The bundle has no pending workflow action.</p>
        </section>
      )}

      <ol className="relative ml-4 border-l border-border">
        {snapshot.stages.map((stage, index) => (
          <WorkflowStageRow index={index + 1} key={stage.id} stage={stage} />
        ))}
      </ol>
      <section className="border-y border-border py-5">
        <p className="text-xs font-semibold uppercase text-muted-foreground">Optional knowledge expansion</p>
        {snapshot.optionalOperations.length > 0 ? <div className="mt-3 space-y-3">{snapshot.optionalOperations.map((operation) => <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" key={operation.id}><div><div className="flex flex-wrap items-center gap-2"><h2 className="font-medium">{operation.label}</h2><Badge variant="outline">{formatStatus(operation.status)}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{operation.detail}{operation.currentItem ? ` · ${operation.stage.replaceAll("_", " ")} ${operation.currentItem}` : ""}</p></div>{operation.action ? <Button asChild size="sm" variant="outline"><Link href={operation.action.href}>{operation.action.label}<ArrowRight /></Link></Button> : null}</div>)}</div> : <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm text-muted-foreground">Research approved concepts to discover additional grounded topics.</p><Button asChild size="sm" variant="outline"><Link href={`/knowledge/${bundleId}/topic-expansion`}>Open topic expansion<ArrowRight /></Link></Button></div>}
      </section>
    </div>
  );
}

function WorkflowStageRow({ index, stage }: { index: number; stage: BundleWorkflowStage }) {
  return (
    <li className="relative border-b border-border py-5 pl-8 first:pt-0 last:border-b-0">
      <span className={cn(
        "absolute -left-4 flex size-8 items-center justify-center rounded-full border bg-background",
        index === 1 ? "top-0" : "top-5",
        toneForStatus(stage.status),
      )}>
        <WorkflowStatusIcon status={stage.status} />
      </span>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Step {index}</span>
            <h2 className="font-semibold">{stage.title}</h2>
            <Badge variant={stage.status === "failed" ? "destructive" : "outline"}>{formatStatus(stage.status)}</Badge>
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">{stage.detail}</p>
        </div>
        {stage.actionHref && stage.actionLabel ? (
          <Button asChild className="shrink-0" size="sm" variant="ghost"><Link href={stage.actionHref}>{stage.actionLabel}<ArrowRight /></Link></Button>
        ) : null}
      </div>
    </li>
  );
}

function WorkflowStatusIcon({ status }: { status: BundleWorkflowStatus }) {
  const className = cn("size-4", status === "running" && "motion-safe:animate-spin");
  if (status === "completed") return <Check className={className} />;
  if (status === "running") return <LoaderCircle className={className} />;
  if (status === "failed") return <AlertCircle className={className} />;
  if (status === "action_required" || status === "completed_with_warnings") return <Clock3 className={className} />;
  return <Circle className={className} />;
}

function toneForStatus(status: BundleWorkflowStatus) {
  if (status === "completed") return "border-emerald-500/50 text-emerald-600 dark:text-emerald-400";
  if (status === "running") return "border-sky-500/50 text-sky-600 dark:text-sky-400";
  if (status === "failed") return "border-destructive/50 text-destructive";
  if (status === "action_required" || status === "completed_with_warnings") return "border-amber-500/50 text-amber-600 dark:text-amber-400";
  return "text-muted-foreground";
}

function formatStatus(status: string) {
  return status.replaceAll("_", " ");
}

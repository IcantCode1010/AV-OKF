import Link from "next/link";
import {
  CheckCircle2,
  Circle,
  CircleAlert,
  Clock3,
  FileText,
  LoaderCircle,
  Minus,
  RotateCcw,
  Settings,
  Workflow,
} from "lucide-react";

import {
  confirmKnowledgeAuthoringCostAction,
  retryKnowledgeAuthoringAction,
  runExtractionAction,
  startKnowledgeAuthoringAction,
} from "@/app/(app)/documents/actions";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  DocumentProcessingStage,
  DocumentProcessingState,
} from "@/lib/document-processing-state";
import { cn } from "@/lib/utils";

type ProcessingPanelRun = {
  automaticApprovalRun: {
    id: string;
    knowledgeBundleId: string;
    status: string;
  } | null;
  estimatedInputTokens: number;
  errorMessage: string | null;
  id: string;
  status: string;
};

export function DocumentProcessingPanel({
  documentId,
  extractionReady,
  firstTopicId,
  run,
  state,
}: {
  documentId: string;
  extractionReady: boolean;
  firstTopicId: string | null;
  run: ProcessingPanelRun | null;
  state: DocumentProcessingState;
}) {
  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex flex-col gap-4 border-b border-border p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <div
            className={cn(
              "relative flex h-12 w-12 shrink-0 items-center justify-center rounded-md border",
              state.active
                ? "border-primary/40 bg-primary/10 text-primary"
                : state.headerTone === "failed"
                  ? "border-destructive/40 bg-destructive/10 text-destructive"
                  : "border-border bg-muted text-muted-foreground",
            )}
          >
            <FileText className={cn("h-6 w-6", state.active && "animate-pulse motion-reduce:animate-none")} />
            {state.active ? (
              <LoaderCircle className="absolute -right-1 -top-1 h-4 w-4 animate-spin rounded-full bg-card motion-reduce:animate-none" />
            ) : null}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">Document processing</h2>
              <Badge variant="outline">{state.bundleName}</Badge>
              <Badge variant={state.automaticApprovalEnabled ? "default" : "secondary"}>
                Automatic approval {state.automaticApprovalEnabled ? "on" : "off"}
              </Badge>
            </div>
            <p aria-live="polite" className="mt-1 text-sm text-muted-foreground">
              {state.active ? `${state.currentLabel} is in progress.` : state.currentDetail}
            </p>
          </div>
        </div>
        <ProcessingAction
          documentId={documentId}
          extractionReady={extractionReady}
          firstTopicId={firstTopicId}
          run={run}
          state={state}
        />
      </div>

      <ol aria-label="Document processing stages" className="p-5">
        {state.stages.map((stage, index) => (
          <li className="relative flex gap-3 pb-5 last:pb-0" key={stage.id}>
            {index < state.stages.length - 1 ? (
              <span aria-hidden className="absolute left-[11px] top-6 h-[calc(100%-1.25rem)] w-px bg-border" />
            ) : null}
            <StageIcon stage={stage} />
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">{stage.label}</p>
                <Badge className="capitalize" variant={stageBadgeVariant(stage.status)}>
                  {stage.status.replaceAll("_", " ")}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{stage.detail}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function DocumentProcessingStatusStrip({
  documentId,
  state,
}: {
  documentId: string;
  state: DocumentProcessingState;
}) {
  if (!state.showHeader) return null;

  const statusText = state.active
    ? `${state.currentLabel} is ${currentStageStatus(state)}`
    : state.headerTone === "failed"
      ? `${state.currentLabel} failed`
      : `${state.currentLabel} needs attention`;

  return (
    <Link
      aria-live="polite"
      className={cn(
        "flex min-h-11 items-center gap-3 border-t px-4 py-2 text-sm outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
        state.headerTone === "failed"
          ? "border-destructive/30 bg-destructive/10 text-destructive"
          : state.headerTone === "attention"
            ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
            : "border-primary/30 bg-primary/10 text-foreground hover:bg-primary/15",
      )}
      href={`/documents/${documentId}?panel=processing`}
    >
      {state.active ? (
        <LoaderCircle className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" />
      ) : (
        <CircleAlert className="h-4 w-4 shrink-0" />
      )}
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium">Processing document</span>
        <span aria-hidden> · </span>
        {statusText}
      </span>
      <span className="shrink-0 text-xs font-medium">View progress</span>
    </Link>
  );
}

function ProcessingAction({
  documentId,
  extractionReady,
  firstTopicId,
  run,
  state,
}: {
  documentId: string;
  extractionReady: boolean;
  firstTopicId: string | null;
  run: ProcessingPanelRun | null;
  state: DocumentProcessingState;
}) {
  const extractionStage = state.stages.find((stage) => stage.id === "extraction");
  if (extractionStage?.status === "failed") {
    return (
      <form action={runExtractionAction}>
        <input name="id" type="hidden" value={documentId} />
        <PendingSubmitButton pendingLabel="Restarting extraction...">
          <RotateCcw className="h-4 w-4" /> Retry extraction
        </PendingSubmitButton>
      </form>
    );
  }

  if (!run && extractionReady) {
    return (
      <form action={startKnowledgeAuthoringAction}>
        <input name="documentId" type="hidden" value={documentId} />
        <input name="returnPanel" type="hidden" value="processing" />
        <PendingSubmitButton pendingLabel="Starting workflow...">
          <Workflow className="h-4 w-4" /> Start AI authoring
        </PendingSubmitButton>
      </form>
    );
  }

  if (!run) return null;
  if (run.status === "awaiting_provider") {
    return (
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline"><Link href="/settings"><Settings className="h-4 w-4" /> Configure AI provider</Link></Button>
        <RetryAuthoringForm documentId={documentId} runId={run.id} />
      </div>
    );
  }
  if (run.status === "awaiting_cost_confirmation") {
    return (
      <form action={confirmKnowledgeAuthoringCostAction}>
        <input name="documentId" type="hidden" value={documentId} />
        <input name="runId" type="hidden" value={run.id} />
        <input name="returnPanel" type="hidden" value="processing" />
        <PendingSubmitButton pendingLabel="Confirming...">
          Confirm {run.estimatedInputTokens.toLocaleString()} tokens
        </PendingSubmitButton>
      </form>
    );
  }
  if (run.status === "failed") {
    return <RetryAuthoringForm documentId={documentId} runId={run.id} />;
  }
  if (run.automaticApprovalRun) {
    return (
      <Button asChild variant={run.automaticApprovalRun.status === "completed" ? "default" : "outline"}>
        <Link href={`/knowledge/${run.automaticApprovalRun.knowledgeBundleId}/review/${run.automaticApprovalRun.id}`}>
          View automatic approval results
        </Link>
      </Button>
    );
  }
  if (["ready_for_review", "completed"].includes(run.status)) {
    return (
      <Button asChild>
        <Link href={firstTopicId ? `/documents/${documentId}?panel=topics&topic=${firstTopicId}` : `/documents/${documentId}?panel=topics`}>
          Review topics
        </Link>
      </Button>
    );
  }
  return null;
}

function RetryAuthoringForm({ documentId, runId }: { documentId: string; runId: string }) {
  return (
    <form action={retryKnowledgeAuthoringAction}>
      <input name="documentId" type="hidden" value={documentId} />
      <input name="runId" type="hidden" value={runId} />
      <input name="returnPanel" type="hidden" value="processing" />
      <PendingSubmitButton pendingLabel="Retrying...">
        <RotateCcw className="h-4 w-4" /> Retry from failed stage
      </PendingSubmitButton>
    </form>
  );
}

function StageIcon({ stage }: { stage: DocumentProcessingStage }) {
  const className = "relative z-10 h-6 w-6 shrink-0 rounded-full bg-card p-0.5";
  if (stage.status === "completed") return <CheckCircle2 className={cn(className, "text-emerald-500")} />;
  if (stage.status === "failed") return <CircleAlert className={cn(className, "text-destructive")} />;
  if (stage.status === "action_required") return <CircleAlert className={cn(className, "text-amber-500")} />;
  if (stage.status === "running") return <LoaderCircle className={cn(className, "animate-spin text-primary motion-reduce:animate-none")} />;
  if (stage.status === "queued") return <Clock3 className={cn(className, "text-primary")} />;
  if (stage.status === "skipped") return <Minus className={cn(className, "text-muted-foreground")} />;
  return <Circle className={cn(className, "text-muted-foreground/60")} />;
}

function stageBadgeVariant(status: DocumentProcessingStage["status"]) {
  if (status === "failed") return "destructive" as const;
  if (status === "running" || status === "queued") return "default" as const;
  return "outline" as const;
}

function currentStageStatus(state: DocumentProcessingState) {
  return state.stages.find((stage) => stage.label === state.currentLabel)?.status ?? "running";
}

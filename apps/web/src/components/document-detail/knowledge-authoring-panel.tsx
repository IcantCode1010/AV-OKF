import { BrainCircuit, CheckCircle2, CircleAlert, Clock3, RotateCcw } from "lucide-react";

import {
  confirmKnowledgeAuthoringCostAction,
  promoteAuthoringRelationsAction,
  retryKnowledgeAuthoringAction,
  startKnowledgeAuthoringAction,
  undoAuthoringMetadataAction,
} from "@/app/(app)/documents/actions";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type AuthoringRun = {
  completedStages: string[];
  currentStage: string;
  enrichmentCandidateCount: number;
  errorMessage: string | null;
  estimatedInputTokens: number;
  id: string;
  metadataProposals: Array<{ id: string; status: string }>;
  relationSuggestions: unknown;
  stageAudits: Array<{ attempt: number; createdAt: Date; errorMessage: string | null; model: string | null; provider: string | null; stage: string; status: string }>;
  status: string;
};

export function KnowledgeAuthoringPanel({ documentId, extractionReady, run }: { documentId: string; extractionReady: boolean; run: AuthoringRun | null }) {
  const stageSummaries = run ? summarizeStageAudits(run.stageAudits) : [];
  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <BrainCircuit className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">AI-assisted authoring</h2>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Prepares metadata, concepts, enrichments, relation suggestions, and validation results. A person still approves and exports every topic.
          </p>
        </div>
        {run ? <Badge variant="outline" className="capitalize">{run.status.replaceAll("_", " ")}</Badge> : null}
      </div>

      {!run ? (
        <form action={startKnowledgeAuthoringAction}>
          <input name="documentId" type="hidden" value={documentId} />
          {extractionReady ? (
            <PendingSubmitButton pendingLabel="Starting workflow...">
              Start guided authoring
            </PendingSubmitButton>
          ) : (
            <Button disabled>Extraction must finish first</Button>
          )}
        </form>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <Metric label="Current stage" value={run.currentStage.replaceAll("_", " ")} />
            <Metric label="Enrichment candidates" value={String(run.enrichmentCandidateCount)} />
            <Metric label="Estimated input" value={`${run.estimatedInputTokens.toLocaleString()} tokens`} />
            <Metric label="Relation suggestions" value={String(Array.isArray(run.relationSuggestions) ? run.relationSuggestions.length : 0)} />
          </div>

          <ol className="space-y-2" aria-label="Authoring stages">
            {stageSummaries.map(({ audit, attemptCount }) => (
              <li className="flex items-center gap-3 rounded-md border border-border px-3 py-2 text-sm" key={audit.stage}>
                {audit.status === "completed" ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : audit.status === "failed" ? <CircleAlert className="h-4 w-4 text-destructive" /> : <Clock3 className="h-4 w-4 text-amber-500" />}
                <span className="capitalize">{audit.stage.replaceAll("_", " ")}</span>
                {attemptCount > 1 ? <Badge variant="outline">{attemptCount} attempts</Badge> : null}
                <span className="ml-auto text-xs capitalize text-muted-foreground">{audit.status}</span>
              </li>
            ))}
          </ol>

          {run.stageAudits.length > 0 ? (
            <details className="rounded-md border border-border p-3">
              <summary className="cursor-pointer text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Attempt history</summary>
              <ol className="mt-3 space-y-2">
                {run.stageAudits.map((audit, index) => (
                  <li className="grid gap-1 border-l-2 border-border pl-3 text-xs" key={`${audit.stage}-${audit.attempt}-${audit.status}-${index}`}>
                    <span className="font-medium capitalize">{audit.stage.replaceAll("_", " ")} · attempt {audit.attempt} · {audit.status}</span>
                    <span className="text-muted-foreground">{audit.createdAt.toLocaleString()}{audit.provider ? ` · ${audit.provider}${audit.model ? ` / ${audit.model}` : ""}` : ""}</span>
                    {audit.errorMessage ? <span className="text-destructive">{audit.errorMessage}</span> : null}
                  </li>
                ))}
              </ol>
            </details>
          ) : null}

          {run.status === "awaiting_cost_confirmation" ? (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
              <p className="text-sm">This run exceeds the review threshold. Confirm before enrichment calls continue.</p>
              <form action={confirmKnowledgeAuthoringCostAction} className="mt-3">
                <input name="documentId" type="hidden" value={documentId} />
                <input name="runId" type="hidden" value={run.id} />
                <PendingSubmitButton pendingLabel="Confirming...">Confirm and continue</PendingSubmitButton>
              </form>
            </div>
          ) : null}

          {run.errorMessage || run.status === "failed" ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3">
              <p className="text-sm text-destructive">{run.errorMessage ?? "The authoring run failed."}</p>
              <form action={retryKnowledgeAuthoringAction} className="mt-3">
                <input name="documentId" type="hidden" value={documentId} />
                <input name="runId" type="hidden" value={run.id} />
                <PendingSubmitButton pendingLabel="Retrying..."><RotateCcw className="h-4 w-4" /> Retry from failed stage</PendingSubmitButton>
              </form>
            </div>
          ) : null}

          {run.metadataProposals[0]?.status === "applied" ? (
            <form action={undoAuthoringMetadataAction}>
              <input name="documentId" type="hidden" value={documentId} />
              <input name="proposalId" type="hidden" value={run.metadataProposals[0].id} />
              <Button type="submit" variant="outline"><RotateCcw className="h-4 w-4" /> Undo AI metadata</Button>
            </form>
          ) : null}

          {run.status === "ready_for_review" ? (
            <div className="space-y-3 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">
              <p>Review package ready. Select each topic in the tree to edit, compare enrichment, approve it, and export it to OKF.</p>
              {Array.isArray(run.relationSuggestions) && run.relationSuggestions.length > 0 ? (
                <form action={promoteAuthoringRelationsAction}>
                  <input name="documentId" type="hidden" value={documentId} />
                  <input name="runId" type="hidden" value={run.id} />
                  <PendingSubmitButton pendingLabel="Preparing relation review...">Send exported topic relations to review</PendingSubmitButton>
                  <p className="mt-2 text-xs text-muted-foreground">Only suggestions whose source and target topics are approved and exported are promoted. Graph edges still require reviewer approval.</p>
                </form>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function summarizeStageAudits(audits: AuthoringRun["stageAudits"]) {
  const byStage = new Map<string, AuthoringRun["stageAudits"]>();
  for (const audit of audits) byStage.set(audit.stage, [...(byStage.get(audit.stage) ?? []), audit]);
  return [...byStage.entries()].map(([stage, entries]) => ({
    attemptCount: new Set(entries.map((entry) => entry.attempt)).size,
    audit: entries.at(-1) ?? { attempt: 1, createdAt: new Date(0), errorMessage: null, model: null, provider: null, stage, status: "unknown" },
  }));
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md border border-border bg-background p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-sm font-medium capitalize">{value}</p></div>;
}

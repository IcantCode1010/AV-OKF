"use client";

import { retryKnowledgeBundleDeletionAction } from "@/app/(app)/knowledge/actions";
import type { KnowledgeBundleDeletionStatusSnapshot } from "@/lib/knowledge-bundle-deletion";
import type { OperationProgressSnapshot } from "@/lib/operation-progress";
import { useOperationProgress, useOperationTerminalRefresh } from "./use-operation-progress";
import { PendingSubmitButton } from "./pending-submit-button";
import { Badge } from "./ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";

export function KnowledgeBundleDeletionLiveStatus({ initialSnapshot }: {
  initialSnapshot: OperationProgressSnapshot<KnowledgeBundleDeletionStatusSnapshot>;
}) {
  const refreshTerminal = useOperationTerminalRefresh();
  const { connected, snapshot } = useOperationProgress({
    initialSnapshot,
    onTerminal: refreshTerminal,
    url: "/api/knowledge-bundle-deletions/status",
  });
  const jobs = snapshot.data.jobs.filter((job) => job.status !== "completed");
  if (jobs.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>Bundle deletion</CardTitle>
            <CardDescription>Knowledge cleanup runs in the background. Source documents remain available as Unassigned.</CardDescription>
          </div>
          {!connected ? <span className="text-xs text-muted-foreground">Reconnecting...</span> : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-3" aria-live="polite">
        {jobs.map((job) => (
          <div className="flex flex-col gap-3 border border-border p-3 sm:flex-row sm:items-center sm:justify-between" key={job.id}>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{job.bundleName}</span>
                <Badge variant={job.status === "failed" ? "destructive" : "outline"}>{job.status}</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{job.documentCount} preserved document{job.documentCount === 1 ? "" : "s"}</p>
              {job.errorMessage ? <p className="mt-1 text-xs text-destructive">{job.errorMessage}</p> : null}
            </div>
            {job.status === "failed" ? (
              <form action={retryKnowledgeBundleDeletionAction}>
                <input name="jobId" type="hidden" value={job.id} />
                <PendingSubmitButton pendingLabel="Retrying...">Retry deletion</PendingSubmitButton>
              </form>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

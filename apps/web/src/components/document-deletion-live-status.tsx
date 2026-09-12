"use client";

import { retryPermanentDocumentDeletionAction } from "@/app/(app)/documents/actions";
import type { DocumentDeletionStatusSnapshot } from "@/lib/document-deletion";
import type { OperationProgressSnapshot } from "@/lib/operation-progress";
import { useOperationProgress, useOperationTerminalRefresh } from "./use-operation-progress";
import { PendingSubmitButton } from "./pending-submit-button";
import { Badge } from "./ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

export function DocumentDeletionLiveStatus({
  initialSnapshot,
  selectedJobId,
}: {
  initialSnapshot: OperationProgressSnapshot<DocumentDeletionStatusSnapshot>;
  selectedJobId?: string;
}) {
  const refreshTerminal = useOperationTerminalRefresh();
  const { connected, snapshot } = useOperationProgress({
    initialSnapshot,
    onTerminal: refreshTerminal,
    url: "/api/document-deletions/status",
  });
  const jobs = snapshot.data.jobs;
  const selectedExists = selectedJobId
    ? jobs.some((job) => job.id === selectedJobId)
    : true;

  if (jobs.length === 0 && (!selectedJobId || selectedExists)) return null;

  return (
    <Card className="border-red-400/20">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Document deletion</CardTitle>
          {!connected ? <span className="text-xs text-muted-foreground">Reconnecting...</span> : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-3" aria-live="polite">
        {selectedJobId && !selectedExists ? (
          <div className="rounded-md border border-emerald-400/30 bg-emerald-400/10 p-3 text-sm text-emerald-700 dark:text-emerald-100">
            Permanent deletion completed. The bundle log contains the removal summary.
          </div>
        ) : null}
        {jobs.map((job) => (
          <div className="flex flex-col gap-3 rounded-md border border-border p-3 sm:flex-row sm:items-center sm:justify-between" key={job.id}>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">{job.documentTitle}</p>
                <Badge variant={job.status === "failed" ? "destructive" : "outline"}>{job.status}</Badge>
              </div>
              <p className={job.errorMessage ? "mt-1 text-xs text-destructive" : "mt-1 text-xs text-muted-foreground"}>
                {job.errorMessage ?? "Source and derived products are being removed."}
              </p>
            </div>
            {job.status === "failed" ? (
              <form action={retryPermanentDocumentDeletionAction}>
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

import { ArrowRight, ShieldCheck } from "lucide-react";

import { confirmBulkTopicApprovalAction } from "@/app/(app)/knowledge/bulk-actions";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { Badge } from "@/components/ui/badge";

export function BulkRunConfirmationPanel({
  bundleId,
  itemCount,
  runId,
  sharedPagePairCount,
}: {
  bundleId: string;
  itemCount: number;
  runId: string;
  sharedPagePairCount: number;
}) {
  return (
    <section className="sticky top-[3.75rem] z-20 border border-primary/40 bg-background/95 p-4 shadow-lg backdrop-blur">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>Step 2 of 2</Badge>
            <ShieldCheck className="size-4 text-primary" />
            <span className="text-sm font-medium">Selection validated</span>
          </div>
          <h2 className="mt-2 text-lg font-semibold">Confirm and start approval</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {itemCount} topics are ready. Nothing has been approved or exported yet.
          </p>
        </div>
        <form action={confirmBulkTopicApprovalAction} className="shrink-0">
          <input name="knowledgeBundleId" type="hidden" value={bundleId} />
          <input name="runId" type="hidden" value={runId} />
          <PendingSubmitButton pendingLabel="Starting approval...">
            Start approval and export <ArrowRight />
          </PendingSubmitButton>
        </form>
      </div>
      <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
        Enrichment is already complete. Topics will be approved and exported sequentially, with live per-topic status below.
      </p>
      {sharedPagePairCount > 0 ? (
        <p className="mt-3 border border-sky-400/30 bg-sky-400/10 p-3 text-sm text-sky-700 dark:text-sky-100">
          {sharedPagePairCount} selected topic {sharedPagePairCount === 1 ? "pair shares" : "pairs share"} source pages. Shared provenance is allowed for this manually reviewed batch; each topic remains a separate article and citation target.
        </p>
      ) : null}
    </section>
  );
}

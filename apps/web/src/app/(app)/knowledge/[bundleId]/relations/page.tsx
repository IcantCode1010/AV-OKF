import { GitBranch } from "lucide-react";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { PendingSubmitButton } from "@/components/pending-submit-button";
import { RelationReviewWorkspace } from "@/components/relation-review-workspace";
import { Badge } from "@/components/ui/badge";
import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import {
  getKnowledgeBundle,
  resolveKnowledgeBundleRoot,
} from "@/lib/knowledge-bundles";
import { loadOkfExplorerSnapshot } from "@/lib/okf-explorer";
import {
  getLatestOkfRelationDiscoveryRun,
  getOkfRelationReviewQueue,
} from "@/lib/okf-relation-discovery";
import { buildOkfRelationReviewItems } from "@/lib/okf-relation-review";
import { isProductionBackend } from "@/lib/production-document-service";
import { getRelationProgressSnapshot } from "@/lib/relation-progress";
import { discoverRelationsAction, expandEntityGraphAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function BundleRelationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ bundleId: string }>;
  searchParams: Promise<{
    relationError?: string;
    relationReverification?: string;
    relationWarnings?: string;
    relationsDiscovered?: string;
    relationsProposed?: string;
    relationsSkipped?: string;
    relationsSuppressed?: string;
    entityExpansion?: string;
  }>;
}) {
  const [{ bundleId }, query, context] = await Promise.all([
    params,
    searchParams,
    requireAuthWorkspaceContext(),
  ]);
  const bundle = await getKnowledgeBundle({ bundleId, context });
  if (!bundle) notFound();

  const snapshotPromise = loadOkfExplorerSnapshot({
    knowledgeBundleId: bundle.id,
    knowledgeRoot: resolveKnowledgeBundleRoot({
      bundleId: bundle.id,
      workspaceId: context.workspaceId,
    }),
    workspaceId: context.workspaceId,
  });
  const [queue, run, snapshot] = isProductionBackend()
    ? await Promise.all([
        getOkfRelationReviewQueue({
          knowledgeBundleId: bundle.id,
          workspaceId: context.workspaceId,
        }),
        getLatestOkfRelationDiscoveryRun({
          knowledgeBundleId: bundle.id,
          workspaceId: context.workspaceId,
        }),
        snapshotPromise,
      ])
    : [
        { actionable: [], filtered: [], published: [], publishedReview: [] },
        null,
        await snapshotPromise,
      ];

  const actionable = buildOkfRelationReviewItems({
    candidates: queue.actionable,
    files: snapshot.files,
  });
  const filtered = buildOkfRelationReviewItems({
    candidates: queue.filtered,
    files: snapshot.files,
  });
  const published = buildOkfRelationReviewItems({
    candidates: queue.published,
    files: snapshot.files,
  });
  const publishedReview = buildOkfRelationReviewItems({
    candidates: queue.publishedReview,
    files: snapshot.files,
  });
  const confirmed = actionable.filter((candidate) =>
    candidate.verificationStatus === "confirmed" &&
    !candidate.automaticApprovalRequested
  );
  const processing = actionable.filter((candidate) =>
    ["queued", "running"].includes(candidate.verificationStatus) &&
    !candidate.automaticApprovalRequested
  );
  const automatic = [
    ...actionable.filter((candidate) => candidate.automaticApprovalRequested),
    ...published,
  ];
  const failed = actionable.filter((candidate) => candidate.verificationStatus === "failed");
  const relationProgress = await getRelationProgressSnapshot({ bundleId: bundle.id, context });

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 border-b border-border pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <GitBranch className="size-5 text-primary" />
            <Badge variant="outline">{bundle.name}</Badge>
          </div>
          <h1 className="mt-3 text-2xl font-semibold">Relation discovery</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            Expand graph ranks deterministic candidates and verifies at most 50 connections against exact source evidence. Entity expansion reconciles grounded assertions from processed documents. Human review remains available; automatic publication requires both the bundle opt-in and the global safety switch, plus exact evidence, 95% confidence, and graph preflight.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <form action={expandEntityGraphAction}>
            <input name="knowledgeBundleId" type="hidden" value={bundle.id} />
            <PendingSubmitButton pendingLabel="Queueing entity expansion..." variant="outline">Reconcile entity connections</PendingSubmitButton>
          </form>
          <form action={discoverRelationsAction}>
            <input name="knowledgeBundleId" type="hidden" value={bundle.id} />
            <PendingSubmitButton pendingLabel="Starting expansion...">Expand concept graph</PendingSubmitButton>
          </form>
        </div>
      </header>

      {query.relationReverification === "queued" || query.relationError === "relation_verification_stale_content" ? (
        <Notice tone="info">
          The source or target concept changed after this relation was verified. It was automatically sent through verification again and will return to review only if the current evidence still supports it.
        </Notice>
      ) : query.relationError ? <Notice tone="error">Relation approval was blocked: {query.relationError.replaceAll("_", " ")}.</Notice> : null}
      {query.relationsDiscovered ? <Notice tone="success">Proposed {query.relationsProposed ?? query.relationsDiscovered}, skipped {query.relationsSkipped ?? "0"} already known, suppressed {query.relationsSuppressed ?? "0"}, and queued {query.relationsDiscovered} for verification. Retained {query.relationWarnings ?? "0"} warnings.</Notice> : null}
      {query.entityExpansion === "queued" ? <Notice tone="info">Entity connection reconciliation is queued. It will stop after the finite candidate set and send at most 50 resolved relations to verification.</Notice> : null}

      {run ? (
        <div className="grid grid-cols-2 divide-x divide-y border border-border text-sm sm:grid-cols-3 xl:grid-cols-7 xl:divide-y-0">
          {[
            ["Proposed", run.proposedCount],
            ["Total", run.totalCandidates],
            ["Queued", run.queuedCount],
            ["Running", run.runningCount],
            ["Confirmed", run.confirmedCount],
            ["Filtered", run.filteredCount],
            ["Failed", run.failedCount],
          ].map(([label, value]) => <div className="p-3" key={label}><div className="text-lg font-semibold">{value}</div><div className="text-xs text-muted-foreground">{label}</div></div>)}
        </div>
      ) : null}

      <RelationReviewWorkspace
        automatic={automatic}
        bundleId={bundle.id}
        confirmed={confirmed}
        failed={failed}
        filtered={filtered}
        initialProgress={relationProgress}
        processing={processing}
        publishedReview={publishedReview}
      />
    </div>
  );
}

function Notice({ children, tone }: { children: ReactNode; tone: "error" | "info" | "success" }) {
  const className = tone === "error"
    ? "border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
    : tone === "info"
      ? "border border-sky-500/30 bg-sky-500/10 p-3 text-sm text-sky-900 dark:text-sky-100"
      : "border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-200";
  return <div className={className}>{children}</div>;
}

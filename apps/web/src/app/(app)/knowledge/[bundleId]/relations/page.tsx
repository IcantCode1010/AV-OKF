import Link from "next/link";
import { GitBranch } from "lucide-react";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { PendingSubmitButton } from "@/components/pending-submit-button";
import { RelationVerificationPoller } from "@/components/relation-verification-poller";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import { getKnowledgeBundle } from "@/lib/knowledge-bundles";
import { getLatestOkfRelationDiscoveryRun, getOkfRelationReviewQueue } from "@/lib/okf-relation-discovery";
import { isProductionBackend } from "@/lib/production-document-service";
import { discoverRelationsAction, retryRelationCandidateVerificationAction, reviewRelationCandidateAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function BundleRelationsPage({ params, searchParams }: {
  params: Promise<{ bundleId: string }>;
  searchParams: Promise<{ relationError?: string; relationWarnings?: string; relationsDiscovered?: string; relationsSuppressed?: string }>;
}) {
  const [{ bundleId }, query, context] = await Promise.all([params, searchParams, requireAuthWorkspaceContext()]);
  const bundle = await getKnowledgeBundle({ bundleId, context });
  if (!bundle) notFound();
  const [queue, run] = isProductionBackend()
    ? await Promise.all([
        getOkfRelationReviewQueue({ knowledgeBundleId: bundle.id, workspaceId: context.workspaceId }),
        getLatestOkfRelationDiscoveryRun({ knowledgeBundleId: bundle.id, workspaceId: context.workspaceId }),
      ])
    : [{ actionable: [], filtered: [] }, null];
  const confirmed = queue.actionable.filter((candidate) => candidate.verificationStatus === "confirmed");
  const failed = queue.actionable.filter((candidate) => candidate.verificationStatus === "failed");
  const filtered = queue.filtered;
  const active = queue.actionable.some((candidate) => ["queued", "running"].includes(candidate.verificationStatus));

  return (
    <div className="space-y-5">
      <RelationVerificationPoller active={active} />
      <header className="flex flex-col gap-3 border-b border-border pb-5 md:flex-row md:items-end md:justify-between">
        <div><div className="flex items-center gap-2"><GitBranch className="size-5 text-primary" /><Badge variant="outline">{bundle.name}</Badge></div><h1 className="mt-3 text-2xl font-semibold">Relation discovery</h1><p className="mt-2 max-w-3xl text-sm text-muted-foreground">Deterministic signals propose pairs, the configured model verifies each pair against an exact source quote, and only your approval writes a typed relation.</p></div>
        <form action={discoverRelationsAction}><input name="knowledgeBundleId" type="hidden" value={bundle.id} /><PendingSubmitButton pendingLabel="Starting discovery...">Discover and verify</PendingSubmitButton></form>
      </header>
      {query.relationError ? <Notice tone="error">Relation approval was blocked: {query.relationError.replaceAll("_", " ")}.</Notice> : null}
      {query.relationsDiscovered ? <Notice tone="success">Queued {query.relationsDiscovered} candidates, suppressed {query.relationsSuppressed ?? "0"}, and retained {query.relationWarnings ?? "0"} warnings.</Notice> : null}
      {run ? <div className="grid grid-cols-2 divide-x divide-y border border-border text-sm sm:grid-cols-3 xl:grid-cols-6 xl:divide-y-0">{[["Total", run.totalCandidates], ["Queued", run.queuedCount], ["Running", run.runningCount], ["Confirmed", run.confirmedCount], ["Filtered", run.filteredCount], ["Failed", run.failedCount]].map(([label, value]) => <div className="p-3" key={label}><div className="text-lg font-semibold">{value}</div><div className="text-xs text-muted-foreground">{label}</div></div>)}</div> : null}
      <section><div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold">Ready for human review</h2><Badge variant="outline">{confirmed.length}</Badge></div>{confirmed.length ? <div className="divide-y border border-border">{confirmed.map((candidate) => <RelationCandidate candidate={candidate} key={candidate.id} />)}</div> : <EmptyState>{active ? "Verification is still running." : "No confirmed candidates are waiting for review."}</EmptyState>}</section>
      {failed.length ? <section><div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold">Verification failures</h2><Button asChild size="sm" variant="outline"><Link href="/settings">Configure provider</Link></Button></div><div className="divide-y border border-destructive/30">{failed.map((candidate) => <div className="flex items-center justify-between gap-4 p-3 text-sm" key={candidate.id}><div className="min-w-0"><p className="truncate font-medium">{candidate.sourceFile} -&gt; {candidate.targetFile}</p><p className="mt-1 text-xs text-destructive">{candidate.verificationError}</p></div><form action={retryRelationCandidateVerificationAction}><input name="candidateId" type="hidden" value={candidate.id} /><PendingSubmitButton pendingLabel="Queuing...">Retry</PendingSubmitButton></form></div>)}</div></section> : null}
      {filtered.length ? <details className="border border-border"><summary className="cursor-pointer px-4 py-3 text-sm font-medium">Recent verifier rejections ({filtered.length}{(run?.filteredCount ?? 0) > filtered.length ? ` of ${run?.filteredCount}` : ""})</summary><div className="divide-y border-t border-border">{filtered.map((candidate) => <div className="p-3 text-xs" key={candidate.id}><span className="font-medium">{candidate.sourceFile} -&gt; {candidate.targetFile}</span><span className="ml-2 text-muted-foreground">{candidate.verificationRationale}</span></div>)}</div></details> : null}
    </div>
  );
}

function RelationCandidate({ candidate }: { candidate: Awaited<ReturnType<typeof getOkfRelationReviewQueue>>["actionable"][number] }) {
  const reverse = candidate.verificationDirection === "reverse";
  const source = reverse ? candidate.targetFile : candidate.sourceFile;
  const target = reverse ? candidate.sourceFile : candidate.targetFile;
  const swapDirection = reverse ? "proposed" : "reverse";
  const signals = Array.isArray(candidate.signals) ? candidate.signals.filter((signal): signal is string => typeof signal === "string") : [];
  const warnings = signals.filter((signal) => signal.startsWith("preflight_warning:"));
  return (
    <article className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_auto]">
      <div className="min-w-0"><p className="break-words text-sm font-medium">{source} <span className="text-primary">{candidate.verificationRelation}</span> {target}</p><p className="mt-1 text-xs text-muted-foreground">Deterministic proposal: {candidate.reason}</p><div className="mt-3 flex flex-wrap gap-2"><Badge variant="outline">{Math.round((candidate.verificationConfidence ?? 0) * 100)}% confidence</Badge><Badge variant="outline">{candidate.verificationProvider}/{candidate.verificationModel}</Badge></div><blockquote className="mt-3 border-l-2 border-emerald-500 px-3 text-sm text-muted-foreground">{candidate.verificationEvidenceQuote}</blockquote><p className="mt-3 text-xs leading-5 text-muted-foreground">{candidate.verificationRationale}</p>{warnings.length ? <p className="mt-2 text-xs text-amber-600 dark:text-amber-300">{warnings.map((warning) => warning.split(":").at(-1)?.replaceAll("_", " ")).join(", ")}</p> : null}</div>
      <div className="flex flex-wrap gap-2 lg:flex-col"><form action={reviewRelationCandidateAction}><input name="candidateId" type="hidden" value={candidate.id} /><input name="decision" type="hidden" value="approve" /><PendingSubmitButton pendingLabel="Approving...">Approve</PendingSubmitButton></form>{candidate.verificationRelation !== "conflicts_with" ? <form action={retryRelationCandidateVerificationAction}><input name="candidateId" type="hidden" value={candidate.id} /><input name="direction" type="hidden" value={swapDirection} /><PendingSubmitButton pendingLabel="Queuing...">Swap and reverify</PendingSubmitButton></form> : null}<form action={reviewRelationCandidateAction}><input name="candidateId" type="hidden" value={candidate.id} /><input name="decision" type="hidden" value="reject" /><PendingSubmitButton pendingLabel="Rejecting...">Reject</PendingSubmitButton></form></div>
    </article>
  );
}

function Notice({ children, tone }: { children: ReactNode; tone: "error" | "success" }) { return <div className={tone === "error" ? "border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" : "border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-200"}>{children}</div>; }
function EmptyState({ children }: { children: ReactNode }) { return <div className="border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{children}</div>; }

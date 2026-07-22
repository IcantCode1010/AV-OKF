import Link from "next/link";
import { ArrowLeft, Database, Layers3, Trash2 } from "lucide-react";
import { notFound } from "next/navigation";

import { KnowledgeExplorer } from "@/components/knowledge-explorer/knowledge-explorer";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import { getKnowledgeBundle, resolveKnowledgeBundleRoot } from "@/lib/knowledge-bundles";
import { loadOkfExplorerSnapshot } from "@/lib/okf-explorer";
import { listOkfRelationCandidates } from "@/lib/okf-relation-discovery";
import { listKnowledgeGaps } from "@/lib/knowledge-gaps";
import { isProductionBackend } from "@/lib/production-document-service";
import {
  activateKnowledgeProfileAction,
  createKnowledgeProfileDraftAction,
  deleteOkfBundleFilesAction,
  discoverRelationsAction,
  reviewRelationCandidateAction,
} from "../actions";

export const dynamic = "force-dynamic";

export default async function KnowledgeBundlePage({
  params,
  searchParams,
}: {
  params: Promise<{ bundleId: string }>;
  searchParams: Promise<{
    deleteError?: string;
    deleted?: string;
    file?: string;
    profileActivated?: string;
    profileDraft?: string;
    relationError?: string;
    relationWarnings?: string;
    relationsDiscovered?: string;
    relationsSuppressed?: string;
  }>;
}) {
  const [{ bundleId }, query, context] = await Promise.all([
    params,
    searchParams,
    requireAuthWorkspaceContext(),
  ]);
  const bundle = await getKnowledgeBundle({ bundleId, context });
  if (!bundle) notFound();
  const knowledgeRoot = resolveKnowledgeBundleRoot({
    bundleId: bundle.id,
    workspaceId: context.workspaceId,
  });
  const snapshot = await loadOkfExplorerSnapshot({
    knowledgeBundleId: bundle.id,
    knowledgeRoot,
    requestedFile: query.file,
    workspaceId: context.workspaceId,
  });
  const relationCandidates = isProductionBackend()
    ? await listOkfRelationCandidates({ knowledgeBundleId: bundle.id, workspaceId: context.workspaceId })
    : [];
  const knowledgeGaps = isProductionBackend()
    ? await listKnowledgeGaps({ context, knowledgeBundleId: bundle.id })
    : [];

  return (
    <div className="-mx-4 sm:-mx-6 lg:-mx-8">
      <div className="flex min-h-[calc(100dvh-4rem)] flex-col lg:h-[calc(100dvh-4rem)] lg:min-h-0">
        <header className="px-4 py-4 sm:px-6 lg:px-8">
          <Button asChild className="mb-3" size="sm" variant="ghost"><Link href="/knowledge"><ArrowLeft className="size-4" />Knowledge vault</Link></Button>
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="flex gap-2"><Badge variant="secondary">{bundle.profile.name}</Badge><Badge variant="outline">Profile v{bundle.activeProfileVersion}</Badge></div>
              <h1 className="mt-3 text-2xl font-semibold">{bundle.name}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{bundle.description}</p>
            </div>
            <div className="flex flex-wrap gap-2"><Button asChild size="sm"><Link href={`/knowledge/${bundle.id}/review`}><Layers3 className="size-4" />Review and export topics</Link></Button><Badge variant="outline">{snapshot.files.length} files</Badge><Badge variant="outline">{snapshot.nodes.length} concepts</Badge><Badge variant="outline">{snapshot.edges.length} relations</Badge></div>
          </div>
        </header>

        {query.deleteError || query.deleted ? <div className="px-4 pb-4 sm:px-6 lg:px-8">{query.deleteError ? <div className="border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">{query.deleteError}</div> : null}{query.deleted ? <div className="border border-emerald-400/30 bg-emerald-400/10 p-3 text-sm text-emerald-200">Marked {query.deleted} files as deleted.</div> : null}</div> : null}
        <KnowledgeExplorer snapshot={snapshot} />
      </div>

      <section className="px-4 py-6 sm:px-6 lg:px-8">
        <details className="mb-4 border border-border bg-muted/10">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring">
            Knowledge gaps ({knowledgeGaps.length})
          </summary>
          <div className="space-y-3 border-t border-border p-4">
            <p className="text-xs text-muted-foreground">
              Questions recorded when this bundle did not contain enough supported evidence for a reliable answer.
            </p>
            {knowledgeGaps.length === 0 ? (
              <div className="border border-dashed border-border p-3 text-xs text-muted-foreground">
                No open knowledge gaps have been recorded for this bundle.
              </div>
            ) : knowledgeGaps.map((gap) => (
              <div className="border border-border p-3 text-xs" key={gap.id}>
                <div className="font-medium">{gap.question}</div>
                <div className="mt-1 text-muted-foreground">
                  {gap.reason === "no_matching_evidence"
                    ? "No matching evidence was found."
                    : "Related evidence was found, but it did not answer the question."}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                  <span>Route: {gap.route}</span>
                  <span>{new Date(gap.createdAt).toLocaleString()}</span>
                </div>
                {gap.searchedSources.length > 0 ? (
                  <div className="mt-1 text-muted-foreground">
                    Searched: {gap.searchedSources.join(", ")}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </details>
        <details className="mb-4 border border-border bg-muted/10">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring">Relation discovery</summary>
          <div className="space-y-4 border-t border-border p-4">
            {query.relationError ? <div className="border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">Relation approval was blocked by graph preflight: {query.relationError.replaceAll("_", " ")}.</div> : null}
            <div className="flex items-center justify-between gap-3"><p className="text-xs text-muted-foreground">Deterministic signals create pending candidates only. Candidates cannot affect graph traversal until a reviewer approves them and the source concept is re-exported.</p><form action={discoverRelationsAction}><input name="knowledgeBundleId" type="hidden" value={bundle.id} /><PendingSubmitButton pendingLabel="Discovering...">Discover relations</PendingSubmitButton></form></div>
            {query.relationsDiscovered ? <div className="border border-emerald-400/30 bg-emerald-400/10 p-3 text-sm">Relation discovery created {query.relationsDiscovered} review candidates, suppressed {query.relationsSuppressed ?? "0"} invalid or duplicate pairs, and retained {query.relationWarnings ?? "0"} warnings.</div> : null}
            <div className="space-y-2">{relationCandidates.filter((candidate) => candidate.status === "pending").map((candidate) => {
              const signals = Array.isArray(candidate.signals) ? candidate.signals.filter((signal): signal is string => typeof signal === "string") : [];
              const warnings = signals.filter((signal) => signal.startsWith("preflight_warning:"));
              return <div className="grid gap-3 border border-border p-3 text-xs lg:grid-cols-[1fr_auto] lg:items-center" key={candidate.id}><div><div className="font-medium">{candidate.sourceFile} <span className="text-muted-foreground">{candidate.relation}</span> {candidate.targetFile}</div><div className="mt-1 text-muted-foreground">{candidate.reason}</div>{warnings.length > 0 ? <div className="mt-2 text-amber-300">{warnings.map((warning) => warning.split(":").at(-1)?.replaceAll("_", " ")).join(", ")}</div> : null}</div><div className="flex flex-wrap gap-2"><form action={reviewRelationCandidateAction}><input name="candidateId" type="hidden" value={candidate.id} /><input name="decision" type="hidden" value="approve" /><input name="direction" type="hidden" value="proposed" /><PendingSubmitButton pendingLabel="Approving...">Approve</PendingSubmitButton></form>{candidate.relation !== "conflicts_with" ? <form action={reviewRelationCandidateAction}><input name="candidateId" type="hidden" value={candidate.id} /><input name="decision" type="hidden" value="approve" /><input name="direction" type="hidden" value="reverse" /><PendingSubmitButton pendingLabel="Swapping...">Swap direction</PendingSubmitButton></form> : null}<form action={reviewRelationCandidateAction}><input name="candidateId" type="hidden" value={candidate.id} /><input name="decision" type="hidden" value="reject" /><PendingSubmitButton pendingLabel="Rejecting...">Reject</PendingSubmitButton></form></div></div>;
            })}</div>
          </div>
        </details>
        <details className="mb-4 border border-border bg-muted/10">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring">Bundle profile and validation</summary>
          <div className="grid gap-6 border-t border-border p-4 xl:grid-cols-2">
            <form action={createKnowledgeProfileDraftAction} className="grid gap-3">
              <input name="knowledgeBundleId" type="hidden" value={bundle.id} />
              <p className="text-xs text-muted-foreground">Edits clone profile v{bundle.activeProfileVersion} into a draft. Base field semantics cannot be changed.</p>
              <input className="h-9 border border-input bg-background px-3 text-sm" defaultValue={bundle.profile.name} name="profileName" placeholder="Profile name" />
              <label className="flex items-start gap-3 border border-border bg-background/40 p-3 text-sm">
                <input
                  className="mt-0.5 size-4"
                  defaultChecked={bundle.profile.automation.autoApproveEnrichedTopics}
                  name="autoApproveEnrichedTopics"
                  type="checkbox"
                  value="true"
                />
                <span>
                  <span className="block font-medium">Automatically approve eligible enriched topics</span>
                  <span className="mt-1 block text-xs text-muted-foreground">High-confidence topics only. Automated approvals remain visibly distinct from human-reviewed knowledge.</span>
                </span>
              </label>
              <div className="grid gap-2 sm:grid-cols-3"><input className="h-9 border border-input bg-background px-3 text-sm" name="typeId" placeholder="New type id" /><input className="h-9 border border-input bg-background px-3 text-sm" name="typeLabel" placeholder="Type label" /><select className="h-9 border border-input bg-background px-3 text-sm" name="typeCategory"><option value="concepts">Concepts</option><option value="procedures">Procedures</option><option value="references">References</option><option value="routing">Routing</option><option value="indexes">Indexes</option></select></div>
              <div className="grid gap-2 sm:grid-cols-3"><input className="h-9 border border-input bg-background px-3 text-sm" name="fieldId" placeholder="New field id" /><select className="h-9 border border-input bg-background px-3 text-sm" name="fieldType"><option value="string">String</option><option value="string_array">String list</option><option value="date">Date</option><option value="number">Number</option><option value="number_array">Number list</option></select><select className="h-9 border border-input bg-background px-3 text-sm" name="fieldRequired"><option value="false">Optional</option><option value="true">Required</option></select></div>
              <label className="grid gap-1 text-xs">Clarification fields<input className="h-9 border border-input bg-background px-3 text-sm" defaultValue={bundle.profile.clarificationFields.join(", ")} name="clarificationFields" placeholder="subject_family, document_type, tags" /></label>
              <label className="grid gap-1 text-xs">Relation discovery stopwords<input className="h-9 border border-input bg-background px-3 text-sm" defaultValue={bundle.profile.relationDiscovery.stopwords.join(", ")} name="relationDiscoveryStopwords" placeholder="concept, document, overview, system" /></label>
              <textarea className="min-h-20 border border-input bg-background p-3 text-sm" defaultValue={bundle.profile.relations.join(", ")} name="relations" />
              <PendingSubmitButton pendingLabel="Saving draft...">Save profile draft</PendingSubmitButton>
            </form>
            <div className="space-y-3">
              {query.profileDraft ? <div className="border border-amber-400/30 bg-amber-400/10 p-3 text-sm">Draft v{query.profileDraft} is ready for validation and activation.</div> : null}
              {query.profileActivated ? <div className="border border-emerald-400/30 bg-emerald-400/10 p-3 text-sm">Profile v{query.profileActivated} activated.</div> : null}
              <form action={activateKnowledgeProfileAction} className="flex items-end gap-2"><input name="knowledgeBundleId" type="hidden" value={bundle.id} /><label className="grid flex-1 gap-1 text-xs">Draft version<input className="h-9 border border-input bg-background px-3 text-sm" defaultValue={query.profileDraft ?? ""} min="1" name="version" required type="number" /></label><PendingSubmitButton pendingLabel="Validating...">Validate and activate</PendingSubmitButton></form>
              <div className="text-xs text-muted-foreground">Activation validates every file and preserves existing type folder placement. Failure leaves the active profile unchanged.</div>
            </div>
          </div>
        </details>
        <details className="border border-border bg-muted/10">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring"><Trash2 className="size-4" />Manage active concept files<Badge className="ml-auto" variant="outline">Lifecycle</Badge></summary>
          <form action={deleteOkfBundleFilesAction} className="border-t border-border p-4">
            <input name="knowledgeBundleId" type="hidden" value={bundle.id} />
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {snapshot.files.filter((file) => !file.isReserved).map((file) => <label className="flex min-w-0 items-center gap-2 border border-border px-3 py-2 text-xs" key={file.filename}><input className="size-4" name="filenames" type="checkbox" value={file.filename} /><span className="truncate">{file.title}</span></label>)}
            </div>
            {snapshot.files.every((file) => file.isReserved) ? <div className="mt-3 flex items-center gap-2 border border-dashed border-border p-3 text-xs text-muted-foreground"><Database className="size-4" />No active concept files can be managed.</div> : <div className="mt-4 flex gap-3"><textarea className="min-h-20 flex-1 border border-input bg-background p-3 text-sm" name="reason" placeholder="Lifecycle reason" required /><PendingSubmitButton pendingLabel="Deleting...">Delete selected files</PendingSubmitButton></div>}
          </form>
        </details>
      </section>
    </div>
  );
}

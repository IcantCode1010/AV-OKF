"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  Clock3,
  FileText,
  Search,
  ShieldCheck,
  XCircle,
} from "lucide-react";

import {
  retryRelationCandidateVerificationAction,
  reviewRelationCandidateAction,
  reviewPublishedRelationCandidateAction,
} from "@/app/(app)/knowledge/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { humanizeRelationFailure } from "@/lib/okf-relation-definitions";
import type { OkfRelationReviewConcept, OkfRelationReviewItem } from "@/lib/okf-relation-review";

type ReviewView = "review" | "published" | "processing" | "automatic" | "filtered" | "failed";
const PAGE_SIZE = 25;

export function RelationReviewWorkspace({
  automatic,
  bundleId,
  confirmed,
  failed,
  filtered,
  processing,
  publishedReview = [],
}: {
  automatic: OkfRelationReviewItem[];
  bundleId: string;
  confirmed: OkfRelationReviewItem[];
  failed: OkfRelationReviewItem[];
  filtered: OkfRelationReviewItem[];
  processing: OkfRelationReviewItem[];
  publishedReview?: OkfRelationReviewItem[];
}) {
  const [view, setView] = useState<ReviewView>(() => defaultView({ automatic, confirmed, failed, processing, publishedReview }));
  const [query, setQuery] = useState("");
  const [relation, setRelation] = useState("all");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const itemsByView = { automatic, failed, filtered, processing, published: publishedReview, review: confirmed };
  const currentItems = itemsByView[view];
  const relationTypes = useMemo(
    () => [...new Set(currentItems.map((item) => item.relation))].sort(),
    [currentItems],
  );
  const matchingItems = useMemo(
    () => currentItems.filter((item) => matchesFilters(item, query, relation)),
    [currentItems, query, relation],
  );
  const visibleItems = matchingItems.slice(0, limit);

  function changeView(next: ReviewView) {
    setView(next);
    setQuery("");
    setRelation("all");
    setLimit(PAGE_SIZE);
  }

  return (
    <div className="space-y-5">
      <div aria-label="Relation status filters" className="flex flex-wrap gap-1 rounded-md border border-border bg-muted/30 p-1">
        <ViewButton active={view === "review"} count={confirmed.length} icon={<ShieldCheck />} label="Needs review" onClick={() => changeView("review")} />
        <ViewButton active={view === "published"} count={publishedReview.length} icon={<FileText />} label="Published review" onClick={() => changeView("published")} />
        <ViewButton active={view === "processing"} count={processing.length} icon={<Clock3 />} label="Processing" onClick={() => changeView("processing")} />
        <ViewButton active={view === "automatic"} count={automatic.length} icon={<CheckCircle2 />} label="Automatic" onClick={() => changeView("automatic")} />
        <ViewButton active={view === "filtered"} count={filtered.length} icon={<XCircle />} label="Filtered" onClick={() => changeView("filtered")} />
        <ViewButton active={view === "failed"} count={failed.length} icon={<CircleAlert />} label="Failed" onClick={() => changeView("failed")} />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <span className="sr-only">Search relation candidates</span>
          <input
            className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm"
            onChange={(event) => { setQuery(event.target.value); setLimit(PAGE_SIZE); }}
            placeholder="Search concepts or source documents"
            type="search"
            value={query}
          />
        </label>
        <label>
          <span className="sr-only">Filter by relation type</span>
          <select
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm sm:w-48"
            onChange={(event) => { setRelation(event.target.value); setLimit(PAGE_SIZE); }}
            value={relation}
          >
            <option value="all">All relation types</option>
            {relationTypes.map((value) => <option key={value} value={value}>{formatLabel(value)}</option>)}
          </select>
        </label>
      </div>

      {view === "review" ? (
        <ConfirmedRelations bundleId={bundleId} items={visibleItems} />
      ) : view === "published" ? (
        <PublishedReviewRelations bundleId={bundleId} items={visibleItems} />
      ) : view === "processing" ? (
        <ProcessingRelations bundleId={bundleId} items={visibleItems} />
      ) : view === "automatic" ? (
        <AutomaticRelations bundleId={bundleId} items={visibleItems} />
      ) : view === "filtered" ? (
        <FilteredRelations bundleId={bundleId} items={visibleItems} />
      ) : (
        <FailedRelations bundleId={bundleId} items={visibleItems} />
      )}

      {matchingItems.length === 0 ? <EmptyState>{currentItems.length ? "No relations match these filters." : emptyMessage(view)}</EmptyState> : null}
      {matchingItems.length > visibleItems.length ? (
        <div className="flex justify-center"><Button onClick={() => setLimit((current) => current + PAGE_SIZE)} variant="outline">Show {Math.min(PAGE_SIZE, matchingItems.length - visibleItems.length)} more</Button></div>
      ) : null}
    </div>
  );
}

function PublishedReviewRelations({ bundleId, items }: { bundleId: string; items: OkfRelationReviewItem[] }) {
  return <div className="grid gap-3 xl:grid-cols-2">{items.map((item) => (
    <article className="rounded-md border border-amber-500/30 bg-background p-4" key={item.id}>
      <RelationSentence bundleId={bundleId} item={item} />
      <p className="mt-2 text-sm text-muted-foreground">This relation remains published while its explanation is revalidated.</p>
      {item.evidenceQuote ? <blockquote className="mt-3 border-l-2 border-amber-500 pl-3 text-sm leading-6 text-muted-foreground">{item.evidenceQuote}</blockquote> : null}
      {item.rationale ? <p className="mt-3 text-sm leading-6">{item.rationale}</p> : null}
      {item.publishedReviewStatus === "failed" ? <p className="mt-3 text-sm text-destructive">{humanizeRelationFailure(item)}</p> : null}
      <TechnicalDetails item={item} />
      <div className="mt-4 flex flex-wrap gap-2">
        {item.publishedReviewStatus === "ready" && item.verificationStatus === "confirmed" ? <form action={reviewPublishedRelationCandidateAction}><input name="candidateId" type="hidden" value={item.id} /><input name="decision" type="hidden" value="reapprove" /><RelationActionButton pendingLabel="Publishing...">Re-approve explanation</RelationActionButton></form> : null}
        {item.publishedReviewStatus === "failed" || item.verificationStatus === "filtered" ? <form action={retryRelationCandidateVerificationAction}><input name="candidateId" type="hidden" value={item.id} /><RelationActionButton pendingLabel="Queuing..." variant="outline">Retry verification</RelationActionButton></form> : null}
        {item.publishedReviewStatus === "ready" ? <form action={reviewPublishedRelationCandidateAction}><input name="candidateId" type="hidden" value={item.id} /><input name="decision" type="hidden" value="reject" /><RelationActionButton pendingLabel="Removing..." variant="destructive">Reject and remove relation</RelationActionButton></form> : null}
        {["queued", "running"].includes(item.publishedReviewStatus ?? "") ? <Badge variant="outline"><Clock3 className="mr-1 size-3" />{formatLabel(item.publishedReviewStatus ?? "queued")}</Badge> : null}
      </div>
    </article>
  ))}</div>;
}

function ConfirmedRelations({ bundleId, items }: { bundleId: string; items: OkfRelationReviewItem[] }) {
  const groups = groupBySource(items);
  return <div className="space-y-7">{groups.map((group) => (
    <section className="space-y-3" key={group.source.filePath}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2"><FileText className="size-4 text-muted-foreground" /><ConceptLink bundleId={bundleId} concept={group.source} className="font-semibold" /></div>
          <div className="mt-2 flex flex-wrap gap-2"><Badge variant="secondary">{group.source.type}</Badge>{group.source.sourceDocument ? <Badge variant="outline">{group.source.sourceDocument}</Badge> : null}</div>
        </div>
        <Badge variant="outline">{group.items.length} proposed {group.items.length === 1 ? "relation" : "relations"}</Badge>
      </div>
      <div className="grid gap-3 xl:grid-cols-2">{group.items.map((item) => <ConfirmedRelationCard bundleId={bundleId} item={item} key={item.id} />)}</div>
    </section>
  ))}</div>;
}

function ConfirmedRelationCard({ bundleId, item }: { bundleId: string; item: OkfRelationReviewItem }) {
  const swapDirection = item.direction === "reverse" ? "proposed" : "reverse";
  return (
    <article className="flex min-h-full flex-col rounded-md border border-border bg-background p-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge>{item.relationLabel}</Badge>
        <ArrowRight className="size-4 text-muted-foreground" />
        <ConceptLink bundleId={bundleId} concept={item.target} className="font-semibold" />
      </div>
      <p className="mt-3 text-sm leading-6">{item.sentence}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Badge variant="outline">{formatConfidence(item.confidence)} confidence</Badge>
        <Badge variant="secondary">{item.target.type}</Badge>
        {item.target.sourceDocument ? <Badge variant="outline">{item.target.sourceDocument}</Badge> : null}
      </div>
      {item.evidenceQuote ? <div className="mt-4"><p className="text-xs font-semibold uppercase text-muted-foreground">Evidence</p><blockquote className="mt-2 border-l-2 border-emerald-500 pl-3 text-sm leading-6 text-muted-foreground">{item.evidenceQuote}</blockquote></div> : null}
      {item.warnings.length ? <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">{item.warnings.join(" ")}</p> : null}
      {!item.reviewable ? <p className="mt-3 text-xs text-destructive">A concept is no longer active or readable. This relation cannot be approved.</p> : null}
      <TechnicalDetails item={item} />
      <div className="mt-auto flex flex-wrap gap-2 pt-4">
        <form action={reviewRelationCandidateAction}><input name="candidateId" type="hidden" value={item.id} /><input name="decision" type="hidden" value="approve" /><RelationActionButton disabled={!item.reviewable} pendingLabel="Approving...">Approve</RelationActionButton></form>
        {item.relation !== "conflicts_with" ? <form action={retryRelationCandidateVerificationAction}><input name="candidateId" type="hidden" value={item.id} /><input name="direction" type="hidden" value={swapDirection} /><RelationActionButton disabled={!item.reviewable} pendingLabel="Queuing..." variant="outline">Swap and reverify</RelationActionButton></form> : null}
        <form action={reviewRelationCandidateAction}><input name="candidateId" type="hidden" value={item.id} /><input name="decision" type="hidden" value="reject" /><RelationActionButton pendingLabel="Rejecting..." variant="destructive">Reject</RelationActionButton></form>
      </div>
    </article>
  );
}

function ProcessingRelations({ bundleId, items }: { bundleId: string; items: OkfRelationReviewItem[] }) {
  return <div className="divide-y border-y border-border">{items.map((item) => <RelationStatusRow bundleId={bundleId} item={item} key={item.id} status={<Badge className="gap-1" variant="outline"><Clock3 className="size-3" />{formatLabel(item.verificationStatus)}</Badge>} />)}</div>;
}

function AutomaticRelations({ bundleId, items }: { bundleId: string; items: OkfRelationReviewItem[] }) {
  return <div className="divide-y border-y border-border">{items.map((item) => {
    const published = item.status === "approved";
    return <RelationStatusRow bundleId={bundleId} item={item} key={item.id} status={<Badge className={published ? "gap-1 border-emerald-500/40 text-emerald-700 dark:text-emerald-300" : "gap-1"} variant="outline">{published ? <CheckCircle2 className="size-3" /> : <Clock3 className="size-3" />}{published ? "Published" : formatLabel(item.verificationStatus)}</Badge>} />;
  })}</div>;
}

function FilteredRelations({ bundleId, items }: { bundleId: string; items: OkfRelationReviewItem[] }) {
  return <div className="divide-y border-y border-border">{items.map((item) => <div className="py-4" key={item.id}><RelationSentence bundleId={bundleId} item={item} /><p className="mt-2 text-sm text-muted-foreground">{humanizeRelationFailure(item)}</p><TechnicalDetails item={item} /></div>)}</div>;
}

function FailedRelations({ bundleId, items }: { bundleId: string; items: OkfRelationReviewItem[] }) {
  return <div className="divide-y border-y border-destructive/30">{items.map((item) => <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between" key={item.id}><div><RelationSentence bundleId={bundleId} item={item} /><p className="mt-2 text-sm text-destructive">{humanizeRelationFailure(item)}</p></div><form action={retryRelationCandidateVerificationAction}><input name="candidateId" type="hidden" value={item.id} /><RelationActionButton pendingLabel="Queuing...">Retry verification</RelationActionButton></form></div>)}</div>;
}

function RelationStatusRow({ bundleId, item, status }: { bundleId: string; item: OkfRelationReviewItem; status: React.ReactNode }) {
  return <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"><div><RelationSentence bundleId={bundleId} item={item} /><p className="mt-1 text-xs text-muted-foreground">{item.source.sourceDocument ?? "Source document unavailable"} → {item.target.sourceDocument ?? "Target document unavailable"}</p></div>{status}</div>;
}

function RelationSentence({ bundleId, item }: { bundleId: string; item: OkfRelationReviewItem }) {
  return <div className="flex flex-wrap items-center gap-2 text-sm"><ConceptLink bundleId={bundleId} concept={item.source} className="font-medium" /><Badge variant="outline">{item.relationLabel}</Badge><ConceptLink bundleId={bundleId} concept={item.target} className="font-medium" /></div>;
}

function ConceptLink({ bundleId, className, concept }: { bundleId: string; className?: string; concept: OkfRelationReviewConcept }) {
  if (!concept.available) return <span className={className}>{concept.title}</span>;
  return <Link className={`${className ?? ""} hover:text-primary hover:underline`} href={`/knowledge/${bundleId}/topic?file=${encodeURIComponent(concept.filePath)}`}>{concept.title}</Link>;
}

function TechnicalDetails({ item }: { item: OkfRelationReviewItem }) {
  return (
    <details className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
      <summary className="cursor-pointer font-medium text-foreground">Technical details</summary>
      <dl className="mt-3 grid gap-2 leading-5">
        <div><dt className="font-medium text-foreground">Relation meaning</dt><dd>{item.relationDefinition}</dd></div>
        <div><dt className="font-medium text-foreground">Deterministic proposal</dt><dd>{item.initialProposal}</dd></div>
        {item.rationale ? <div><dt className="font-medium text-foreground">Verifier rationale</dt><dd>{item.rationale}</dd></div> : null}
        <div><dt className="font-medium text-foreground">Files</dt><dd className="break-all">{item.source.filePath} → {item.target.filePath}</dd></div>
        {item.provider || item.model ? <div><dt className="font-medium text-foreground">Verifier</dt><dd>{[item.provider, item.model].filter(Boolean).join(" / ")}</dd></div> : null}
        {item.signals.length ? <div><dt className="font-medium text-foreground">Discovery signals</dt><dd>{item.signals.join(", ")}</dd></div> : null}
      </dl>
    </details>
  );
}

function RelationActionButton({ children, disabled = false, pendingLabel, variant = "default" }: { children: React.ReactNode; disabled?: boolean; pendingLabel: string; variant?: "default" | "outline" | "destructive" }) {
  const { pending } = useFormStatus();
  return <Button disabled={disabled || pending} type="submit" variant={variant}>{pending ? pendingLabel : children}</Button>;
}

function ViewButton({ active, count, icon, label, onClick }: { active: boolean; count: number; icon: React.ReactNode; label: string; onClick: () => void }) {
  return <Button aria-pressed={active} onClick={onClick} size="sm" type="button" variant={active ? "secondary" : "ghost"}>{icon}{label}<Badge variant="outline">{count}</Badge></Button>;
}

function groupBySource(items: OkfRelationReviewItem[]) {
  const groups = new Map<string, { items: OkfRelationReviewItem[]; source: OkfRelationReviewConcept }>();
  for (const item of items) {
    const group = groups.get(item.source.filePath) ?? { items: [], source: item.source };
    group.items.push(item);
    groups.set(item.source.filePath, group);
  }
  return [...groups.values()];
}

function matchesFilters(item: OkfRelationReviewItem, query: string, relation: string) {
  if (relation !== "all" && item.relation !== relation) return false;
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [item.source.title, item.target.title, item.source.sourceDocument, item.target.sourceDocument, item.relationLabel]
    .filter(Boolean)
    .some((value) => value!.toLowerCase().includes(needle));
}

function defaultView(input: { automatic: OkfRelationReviewItem[]; confirmed: OkfRelationReviewItem[]; failed: OkfRelationReviewItem[]; processing: OkfRelationReviewItem[]; publishedReview: OkfRelationReviewItem[] }): ReviewView {
  if (input.confirmed.length) return "review";
  if (input.publishedReview.length) return "published";
  if (input.processing.length) return "processing";
  if (input.failed.length) return "failed";
  if (input.automatic.length) return "automatic";
  return "review";
}

function emptyMessage(view: ReviewView) {
  if (view === "review") return "No confirmed relations are waiting for review.";
  if (view === "published") return "No published relations require explanation review.";
  if (view === "processing") return "No relation candidates are being verified.";
  if (view === "automatic") return "No automatically processed relations are available.";
  if (view === "filtered") return "No recent verifier rejections are available.";
  return "No verification failures need attention.";
}

function formatConfidence(value: number | null) {
  return value === null ? "Unknown" : `${Math.round(value * 100)}%`;
}

function formatLabel(value: string) {
  return value.split("_").filter(Boolean).map((word) => word[0]?.toUpperCase() + word.slice(1)).join(" ");
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{children}</div>;
}

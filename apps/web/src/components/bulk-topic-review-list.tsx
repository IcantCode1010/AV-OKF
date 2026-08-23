"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, CheckSquare2, CircleAlert, FileText, LoaderCircle, XCircle } from "lucide-react";

import {
  prepareBulkTopicApprovalAction,
} from "@/app/(app)/knowledge/bulk-actions";
import type { PrepareBulkTopicApprovalState } from "@/app/(app)/knowledge/bulk-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type BulkReviewTopic = {
  confidence: string;
  documentId: string;
  documentTitle: string;
  eligible: boolean;
  eligibilityErrors: string[];
  enrichedSummary: string | null;
  enrichedTitle: string | null;
  enrichmentLevel: "complete" | "partial" | "not_enriched";
  enrichmentScore: number;
  enrichmentStatus: string;
  exportedFilePath: string | null;
  id: string;
  okfType: string;
  overlapWarnings: string[];
  origin?: "document_discovery" | "topic_expansion";
  pageEnd: number;
  pageStart: number;
  proposedSourcePageNumbers: number[];
  reviewStatus: string;
  sourcePageNumbers: number[];
};

type ReviewFilter = "all" | "approved" | "needs_action" | "ready" | "rejected";
type ReviewCategory = "approved" | "needs_review" | "ready" | "rejected";

const initialPrepareBulkTopicApprovalState: PrepareBulkTopicApprovalState = {
  error: null,
  confirmationHref: null,
};

export function BulkTopicReviewList({
  bundleId,
  documentId,
  topics,
}: {
  bundleId: string;
  documentId?: string;
  topics: BulkReviewTopic[];
}) {
  const [prepareState, prepareAction, preparing] = useActionState(
    prepareBulkTopicApprovalAction,
    initialPrepareBulkTopicApprovalState,
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<ReviewFilter>(() =>
    topics.some((topic) => topicNeedsAction(topic)) ? "needs_action" : "all",
  );
  const counts = useMemo(() => countTopics(topics), [topics]);
  const visibleTopics = useMemo(
    () => topics.filter((topic) => matchesFilter(topic, filter)),
    [filter, topics],
  );
  const eligibleIds = useMemo(
    () => visibleTopics.filter((topic) => topic.eligible).map((topic) => topic.id),
    [visibleTopics],
  );
  const groups = useMemo(() => {
    const result = new Map<string, BulkReviewTopic[]>();
    for (const topic of visibleTopics) {
      const key = `${topic.documentId}\u0000${topic.documentTitle}`;
      result.set(key, [...(result.get(key) ?? []), topic]);
    }
    return result;
  }, [visibleTopics]);
  const allSelected = eligibleIds.length > 0 && eligibleIds.every((id) => selected.has(id));

  useEffect(() => {
    if (prepareState.confirmationHref) {
      window.location.assign(prepareState.confirmationHref);
    }
  }, [prepareState.confirmationHref]);

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(eligibleIds));
  }

  function changeFilter(next: ReviewFilter) {
    setFilter(next);
    setSelected(new Set());
  }

  return (
    <form action={prepareAction} className="space-y-5">
      <input name="knowledgeBundleId" type="hidden" value={bundleId} />
      {documentId ? <input name="documentId" type="hidden" value={documentId} /> : null}
      <div
        aria-label="Review status filters"
        className="flex flex-wrap gap-1 rounded-md border border-border bg-muted/30 p-1"
      >
        {([
          ["needs_action", "Needs action", counts.needsAction],
          ["ready", "Ready to approve", counts.ready],
          ["approved", "Approved", counts.approved],
          ["rejected", "Rejected", counts.rejected],
          ["all", "All", topics.length],
        ] as Array<[ReviewFilter, string, number]>).map(([value, label, count]) => (
          <Button
            aria-pressed={filter === value}
            key={value}
            onClick={() => changeFilter(value)}
            size="sm"
            type="button"
            variant={filter === value ? "secondary" : "ghost"}
          >
            {label}
            <Badge variant="outline">{count}</Badge>
          </Button>
        ))}
      </div>
      <div className="border-y border-border py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="secondary">Step 1 of 2</Badge>
            <CheckSquare2 className="size-4" />
            <span>{selected.size} selected</span>
            <Badge variant="outline">{eligibleIds.length} ready for approval</Badge>
          </div>
          <div className="flex gap-2">
            <Button
              disabled={eligibleIds.length === 0}
              onClick={toggleAll}
              type="button"
              variant="outline"
            >
              {allSelected ? "Clear selection" : "Select all ready"}
            </Button>
            <Button disabled={selected.size === 0 || preparing} type="submit">
              {preparing ? <><LoaderCircle className="animate-spin motion-reduce:animate-none" />Validating selection...</> : "Continue to confirmation"}
            </Button>
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          This checks the selected topics and opens a final confirmation. Nothing is approved or exported until Step 2.
        </p>
        {preparing ? (
          <div aria-live="polite" className="mt-3 border border-primary/30 bg-primary/5 p-3 text-sm">
            <p className="font-medium">Preparing your confirmation</p>
            <p className="mt-1 text-muted-foreground">
              Validating {selected.size} selected {selected.size === 1 ? "topic" : "topics"}. Approval has not started yet.
            </p>
          </div>
        ) : null}
        {prepareState.error ? (
          <div aria-live="assertive" className="mt-3 border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            Confirmation could not be prepared: {formatError(prepareState.error)}
          </div>
        ) : null}
      </div>

      {[...groups.entries()].map(([key, documentTopics]) => {
        const [documentId, documentTitle] = key.split("\u0000");
        return (
          <section className="space-y-3" key={documentId}>
            <div className="flex items-center gap-2">
              <FileText className="size-4 text-muted-foreground" />
              <h2 className="font-medium">{documentTitle}</h2>
              <Badge variant="outline">{documentTopics.length} topics</Badge>
            </div>
            <div className="grid gap-3 xl:grid-cols-2">
              {documentTopics.map((topic) => {
                const category = reviewCategory(topic);
                return (
                  <label
                    className={`grid gap-3 rounded-md border p-4 ${topicCardClassName(category)}`}
                    key={topic.id}
                  >
                  <div className="flex items-start gap-3">
                    <input
                      checked={selected.has(topic.id)}
                      className="mt-1 size-4"
                      disabled={!topic.eligible}
                      name="topicIds"
                      onChange={(event) => setSelected((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(topic.id); else next.delete(topic.id);
                        return next;
                      })}
                      type="checkbox"
                      value={topic.id}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap gap-2">
                        <TopicReviewStatus category={category} />
                        <Badge variant="secondary">{topic.okfType}</Badge>
                        {topic.origin === "topic_expansion" ? <Badge className="border-sky-500/40 text-sky-700 dark:text-sky-300" variant="outline">Topic expansion</Badge> : null}
                        <Badge variant="outline">{topic.confidence} confidence</Badge>
                        <Badge variant="outline">
                          Enrichment completeness {topic.enrichmentScore}% · {formatEnrichmentLevel(topic.enrichmentLevel)}
                        </Badge>
                        <Badge variant="outline">pages {topic.pageStart}-{topic.pageEnd}</Badge>
                      </div>
                      <h3 className="mt-3 font-medium">{topic.enrichedTitle ?? "No enriched title"}</h3>
                      <p className="mt-2 text-sm text-muted-foreground">{topic.enrichedSummary ?? "No enriched summary"}</p>
                      <p className="mt-3 text-xs text-muted-foreground">
                        {buildSourceSummary(topic)}
                      </p>
                    </div>
                  </div>
                  {category === "needs_review" && topic.eligibilityErrors.length > 0 ? (
                    <div className="border border-amber-400/30 bg-amber-400/10 p-2 text-xs text-amber-100">
                      Needs individual review: {topic.eligibilityErrors.map(formatError).join(", ")}
                    </div>
                  ) : null}
                  {category === "ready" && topic.overlapWarnings.length > 0 ? (
                    <div className="border border-sky-400/30 bg-sky-400/10 p-2 text-xs text-sky-100">
                      <p className="font-medium">Shared source pages</p>
                      <p className="mt-1">
                        {topic.overlapWarnings.join(" ")} This is disclosed for review and does not block manual bulk approval.
                      </p>
                    </div>
                  ) : null}
                    <Button asChild size="sm" variant="ghost">
                      <Link href={`/documents/${topic.documentId}?panel=topics&topic=${topic.id}`}>
                        {category === "approved" ? "View approved topic" : "Open full topic review"}
                      </Link>
                    </Button>
                  </label>
                );
              })}
            </div>
          </section>
        );
      })}
      {topics.length === 0 ? <div className="border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{documentId ? "No topics exist for this document yet." : "No topics exist in this bundle yet."}</div> : null}
      {topics.length > 0 && visibleTopics.length === 0 ? <div className="border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No topics match this review status.</div> : null}
    </form>
  );
}

function TopicReviewStatus({ category }: { category: ReviewCategory }) {
  if (category === "approved") {
    return <Badge className="gap-1 border-emerald-500/40 text-emerald-700 dark:text-emerald-300" variant="outline"><CheckCircle2 className="size-3" />Approved</Badge>;
  }
  if (category === "ready") {
    return <Badge className="gap-1"><CheckSquare2 className="size-3" />Ready for approval</Badge>;
  }
  if (category === "rejected") {
    return <Badge className="gap-1" variant="destructive"><XCircle className="size-3" />Rejected</Badge>;
  }
  return <Badge className="gap-1 border-amber-500/40 text-amber-700 dark:text-amber-300" variant="outline"><CircleAlert className="size-3" />Needs individual review</Badge>;
}

export function reviewCategory(topic: BulkReviewTopic): ReviewCategory {
  if (topic.reviewStatus === "approved") return "approved";
  if (topic.reviewStatus === "rejected") return "rejected";
  return topic.eligible ? "ready" : "needs_review";
}

function topicNeedsAction(topic: BulkReviewTopic) {
  const category = reviewCategory(topic);
  return category === "ready" || category === "needs_review";
}

function matchesFilter(topic: BulkReviewTopic, filter: ReviewFilter) {
  const category = reviewCategory(topic);
  if (filter === "all") return true;
  if (filter === "needs_action") return category === "ready" || category === "needs_review";
  return category === filter;
}

function countTopics(topics: BulkReviewTopic[]) {
  return topics.reduce(
    (counts, topic) => {
      const category = reviewCategory(topic);
      counts[category] += 1;
      if (category === "ready" || category === "needs_review") counts.needsAction += 1;
      return counts;
    },
    { approved: 0, needsAction: 0, needs_review: 0, ready: 0, rejected: 0 },
  );
}

function topicCardClassName(category: ReviewCategory) {
  if (category === "approved") return "border-emerald-500/25 bg-emerald-500/5";
  if (category === "ready") return "border-primary/40 bg-primary/5";
  if (category === "rejected") return "border-destructive/25 bg-destructive/5";
  return "border-amber-500/30 bg-amber-500/5";
}

function formatError(value: string) {
  return value.replaceAll("_", " ").replace(/^topic /, "");
}

function buildSourceSummary(topic: BulkReviewTopic) {
  const established = formatPages(topic.sourcePageNumbers);
  if (topic.proposedSourcePageNumbers.length === 0) {
    return `Created from source ${established}.`;
  }
  return `Created from source ${established}, with additional context from ${formatPages(topic.proposedSourcePageNumbers)}. Additional context pages will be included in the approved topic's citations.`;
}

function formatPages(pages: number[]) {
  if (pages.length === 0) return "pages unavailable";
  const sorted = [...new Set(pages)].sort((left, right) => left - right);
  const ranges: string[] = [];
  let start = sorted[0]!;
  let end = start;
  for (const page of sorted.slice(1)) {
    if (page === end + 1) {
      end = page;
      continue;
    }
    ranges.push(start === end ? String(start) : `${start}-${end}`);
    start = page;
    end = page;
  }
  ranges.push(start === end ? String(start) : `${start}-${end}`);
  return `${sorted.length === 1 ? "page" : "pages"} ${ranges.join(", ")}`;
}

function formatEnrichmentLevel(level: BulkReviewTopic["enrichmentLevel"]) {
  if (level === "not_enriched") return "Not enriched";
  return level === "complete" ? "Complete" : "Partial";
}

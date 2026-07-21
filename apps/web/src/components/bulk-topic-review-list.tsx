"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CheckSquare2, FileText } from "lucide-react";

import { prepareBulkTopicApprovalAction } from "@/app/(app)/knowledge/bulk-actions";
import { PendingSubmitButton } from "@/components/pending-submit-button";
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
  enrichmentStatus: string;
  exportedFilePath: string | null;
  id: string;
  okfType: string;
  pageEnd: number;
  pageStart: number;
  proposedSourcePageNumbers: number[];
  reviewStatus: string;
};

export function BulkTopicReviewList({ bundleId, topics }: { bundleId: string; topics: BulkReviewTopic[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const eligibleIds = useMemo(() => topics.filter((topic) => topic.eligible).map((topic) => topic.id), [topics]);
  const groups = useMemo(() => {
    const result = new Map<string, BulkReviewTopic[]>();
    for (const topic of topics) {
      const key = `${topic.documentId}\u0000${topic.documentTitle}`;
      result.set(key, [...(result.get(key) ?? []), topic]);
    }
    return result;
  }, [topics]);
  const allSelected = eligibleIds.length > 0 && eligibleIds.every((id) => selected.has(id));

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(eligibleIds));
  }

  return (
    <form action={prepareBulkTopicApprovalAction} className="space-y-5">
      <input name="knowledgeBundleId" type="hidden" value={bundleId} />
      <div className="flex flex-wrap items-center justify-between gap-3 border-y border-border py-3">
        <div className="flex items-center gap-2 text-sm">
          <CheckSquare2 className="size-4" />
          <span>{selected.size} selected</span>
          <Badge variant="outline">{eligibleIds.length} eligible</Badge>
        </div>
        <div className="flex gap-2">
          <Button onClick={toggleAll} type="button" variant="outline">{allSelected ? "Clear selection" : "Select all eligible"}</Button>
          <PendingSubmitButton pendingLabel="Checking batch...">Prepare batch</PendingSubmitButton>
        </div>
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
              {documentTopics.map((topic) => (
                <label className={`grid gap-3 border p-4 ${topic.eligible ? "border-border bg-card" : "border-border/60 bg-muted/20"}`} key={topic.id}>
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
                        <Badge variant="secondary">{topic.okfType}</Badge>
                        <Badge variant="outline">{topic.confidence} confidence</Badge>
                        <Badge variant="outline">pages {topic.pageStart}-{topic.pageEnd}</Badge>
                      </div>
                      <h3 className="mt-3 font-medium">{topic.enrichedTitle ?? "No enriched title"}</h3>
                      <p className="mt-2 text-sm text-muted-foreground">{topic.enrichedSummary ?? "No enriched summary"}</p>
                    </div>
                  </div>
                  {topic.eligibilityErrors.length > 0 ? (
                    <div className="border border-amber-400/30 bg-amber-400/10 p-2 text-xs text-amber-100">
                      Not eligible: {topic.eligibilityErrors.map(formatError).join(", ")}
                    </div>
                  ) : null}
                  <Button asChild size="sm" variant="ghost"><Link href={`/documents/${topic.documentId}?panel=topics&topic=${topic.id}`}>Open full topic review</Link></Button>
                </label>
              ))}
            </div>
          </section>
        );
      })}
      {topics.length === 0 ? <div className="border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No topics exist in this bundle yet.</div> : null}
    </form>
  );
}

function formatError(value: string) {
  return value.replaceAll("_", " ").replace(/^topic /, "");
}

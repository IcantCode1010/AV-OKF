"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowUpRight, CheckCircle2, Clock3, LoaderCircle } from "lucide-react";

import type { BundleActivityItem, BundleActivitySnapshot } from "@/lib/bundle-activity";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type ActivityFilter = "active" | "attention" | "completed" | "all";

export function BundleActivityFeed({ bundleId, snapshot }: { bundleId: string; snapshot: BundleActivitySnapshot }) {
  const [filter, setFilter] = useState<ActivityFilter>(snapshot.active ? "active" : "all");

  useEffect(() => {
    if (!snapshot.active) return;
    let cancelled = false;
    const interval = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/knowledge-bundles/${encodeURIComponent(bundleId)}/activity/status`, {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (!response.ok) return;
        const next = await response.json() as { active?: unknown; fingerprint?: unknown };
        if (cancelled || typeof next.active !== "boolean" || typeof next.fingerprint !== "string") return;
        if (next.fingerprint !== snapshot.fingerprint) window.location.reload();
      } catch {
        // Transient polling failures leave the current truthful snapshot visible.
      }
    }, 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [bundleId, snapshot.active, snapshot.fingerprint]);

  const items = useMemo(() => snapshot.items.filter((item) => matchesFilter(item, filter)), [filter, snapshot.items]);

  return (
    <div className="space-y-5">
      <div className="grid gap-px overflow-hidden rounded-md border bg-border sm:grid-cols-4">
        <Summary label="Processing" value={snapshot.summary.processing} tone="active" />
        <Summary label="Awaiting review" value={snapshot.summary.awaitingReview} tone="attention" />
        <Summary label="Failed" value={snapshot.summary.failed} tone="failed" />
        <Summary label="Completed" value={snapshot.summary.completed} tone="complete" />
      </div>
      <div className="flex flex-wrap gap-1" aria-label="Activity filters">
        {(["active", "attention", "completed", "all"] as const).map((value) => (
          <Button key={value} size="sm" variant={filter === value ? "secondary" : "ghost"} onClick={() => setFilter(value)}>
            {value === "attention" ? "Attention required" : value[0].toUpperCase() + value.slice(1)}
          </Button>
        ))}
      </div>
      <div className="divide-y border-y">
        {items.map((item) => <ActivityRow key={item.id} item={item} />)}
        {items.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">No activity matches this view.</div>
        ) : null}
      </div>
    </div>
  );
}

function ActivityRow({ item }: { item: BundleActivityItem }) {
  const Icon = item.status === "failed" ? AlertCircle : item.status === "completed" ? CheckCircle2 : item.status === "action_required" ? Clock3 : LoaderCircle;
  return (
    <div className="grid gap-3 py-4 md:grid-cols-[1.5rem_minmax(0,1fr)_auto] md:items-start">
      <Icon className={`mt-0.5 h-4 w-4 ${item.status === "failed" ? "text-destructive" : item.status === "completed" ? "text-emerald-500" : "text-amber-500"} ${item.status === "running" ? "motion-safe:animate-spin" : ""}`} aria-hidden="true" />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-medium">{item.title}</p>
          <Badge variant="outline">{item.stage}</Badge>
          <Badge variant={item.status === "failed" ? "destructive" : "secondary"}>{item.status.replaceAll("_", " ")}</Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{item.detail}</p>
        <p className="mt-1 text-xs text-muted-foreground">{formatActivityTimestamp(item.occurredAt)}</p>
      </div>
      {item.actionHref ? (
        <Button asChild variant="ghost" size="sm"><Link href={item.actionHref}>Open <ArrowUpRight className="h-4 w-4" /></Link></Button>
      ) : null}
    </div>
  );
}

function formatActivityTimestamp(value: string) {
  return `${new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(value))} UTC`;
}

function Summary({ label, value, tone }: { label: string; value: number; tone: "active" | "attention" | "failed" | "complete" }) {
  const colors = { active: "text-sky-600 dark:text-sky-400", attention: "text-amber-600 dark:text-amber-400", failed: "text-destructive", complete: "text-emerald-600 dark:text-emerald-400" };
  return <div className="bg-background px-4 py-3"><p className="text-xs text-muted-foreground">{label}</p><p className={`mt-1 text-xl font-semibold ${colors[tone]}`}>{value}</p></div>;
}

function matchesFilter(item: BundleActivityItem, filter: ActivityFilter) {
  if (filter === "all") return true;
  if (filter === "active") return item.status === "queued" || item.status === "running";
  if (filter === "attention") return item.status === "action_required" || item.status === "failed";
  return item.status === "completed";
}

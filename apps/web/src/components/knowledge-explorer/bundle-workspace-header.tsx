import Link from "next/link";
import { BookOpen, Network } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { KnowledgeBundleRecord } from "@/lib/knowledge-bundles";
import { cn } from "@/lib/utils";

export function BundleWorkspaceHeader({
  bundle,
  counts,
  file,
  view,
}: {
  bundle: KnowledgeBundleRecord;
  counts: { concepts: number; files: number; relations: number };
  file: string | null;
  view: "browse" | "graph";
}) {
  const suffix = file ? `?file=${encodeURIComponent(file)}` : "";
  return (
    <header className="flex shrink-0 flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <div className="min-w-0">
        <div className="flex items-center gap-2"><h1 className="truncate text-base font-semibold">{bundle.name}</h1><Badge variant="outline">{bundle.profile.name}</Badge></div>
        <p className="mt-1 truncate text-xs text-muted-foreground">{counts.concepts} concepts · {counts.relations} relations · {counts.files} files</p>
      </div>
      <div className="flex items-center gap-1 rounded-md border border-border bg-muted/30 p-1" aria-label="Knowledge view">
        <Button asChild className={cn(view !== "browse" && "text-muted-foreground")} size="sm" variant={view === "browse" ? "secondary" : "ghost"}><Link href={`/knowledge/${encodeURIComponent(bundle.id)}/browse${suffix}`}><BookOpen />Browse</Link></Button>
        <Button asChild className={cn(view !== "graph" && "text-muted-foreground")} size="sm" variant={view === "graph" ? "secondary" : "ghost"}><Link href={`/knowledge/${encodeURIComponent(bundle.id)}/graph${suffix}`}><Network />Graph</Link></Button>
      </div>
    </header>
  );
}

"use client";

import Link from "next/link";
import { Check, ChevronsUpDown, Plus, Search, Settings2 } from "lucide-react";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { setActiveKnowledgeBundleAction } from "@/app/(app)/shell-actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { sectionForPathname } from "@/lib/active-bundle-navigation";
import { cn } from "@/lib/utils";

export type ShellKnowledgeBundle = {
  description: string;
  id: string;
  name: string;
};

export function ActiveBundleSelector({
  activeBundle,
  bundles,
}: {
  activeBundle: ShellKnowledgeBundle | null;
  bundles: ShellKnowledgeBundle[];
}) {
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const filtered = bundles.filter((bundle) =>
    `${bundle.name} ${bundle.description}`.toLowerCase().includes(query.trim().toLowerCase()),
  );

  if (!activeBundle) {
    return (
      <Button asChild className="w-full justify-start border-white/15 bg-white/5 text-zinc-100 hover:bg-white/10" variant="outline">
        <Link href="/knowledge"><Plus />Create knowledge bundle</Link>
      </Button>
    );
  }

  return (
    <DropdownMenu onOpenChange={(open) => !open && setQuery("")}>
      <DropdownMenuTrigger asChild>
        <Button
          className="h-auto w-full justify-between border-white/15 bg-white/5 px-3 py-2.5 text-left text-zinc-100 hover:bg-white/10 hover:text-white"
          variant="outline"
        >
          <span className="min-w-0">
            <span className="block text-[10px] font-medium uppercase text-zinc-500">Active bundle</span>
            <span className="mt-0.5 block truncate text-sm">{activeBundle.name}</span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-zinc-500" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72 p-2">
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search knowledge bundles"
            className="pl-8"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
            placeholder="Search bundles"
            value={query}
          />
        </div>
        <div className="max-h-64 overflow-y-auto">
          {filtered.length ? filtered.map((bundle) => (
            <form action={setActiveKnowledgeBundleAction} key={bundle.id}>
              <input name="bundleId" type="hidden" value={bundle.id} />
              <input name="section" type="hidden" value={sectionForPathname(pathname)} />
              <button
                className={cn(
                  "flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent",
                  bundle.id === activeBundle.id && "bg-accent/70",
                )}
                type="submit"
              >
                <Check className={cn("mt-0.5 size-4 shrink-0", bundle.id !== activeBundle.id && "invisible")} />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{bundle.name}</span>
                  {bundle.description ? <span className="mt-0.5 block truncate text-xs text-muted-foreground">{bundle.description}</span> : null}
                </span>
              </button>
            </form>
          )) : <p className="px-2 py-4 text-center text-xs text-muted-foreground">No bundles match.</p>}
        </div>
        <DropdownMenuSeparator />
        <div className="grid gap-1">
          <Link className="flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-accent" href="/knowledge"><Plus className="size-4" />New or manage bundles</Link>
          <Link className="flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-accent" href={`/knowledge/${encodeURIComponent(activeBundle.id)}/settings`}><Settings2 className="size-4" />Bundle settings</Link>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

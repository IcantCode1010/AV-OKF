"use client";

import { useMemo, useState, useTransition } from "react";
import { BookOpenCheck, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";

import { updateChatKnowledgeSourcesAction } from "@/app/(app)/chat/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type BundleOption = {
  id: string;
  name: string;
};

export function ChatKnowledgeSourceSelector({
  availableBundles,
  disabled,
  selectedBundleIds,
  sessionId,
}: {
  availableBundles: BundleOption[];
  disabled: boolean;
  selectedBundleIds: string[];
  sessionId: string;
}) {
  const router = useRouter();
  const [isSaving, startSaving] = useTransition();
  const [query, setQuery] = useState("");
  const [draftIds, setDraftIds] = useState<string[] | null>(null);
  const effectiveIds = draftIds ?? selectedBundleIds;

  const optionsById = useMemo(
    () => new Map(availableBundles.map((bundle) => [bundle.id, bundle])),
    [availableBundles],
  );
  const filtered = availableBundles.filter((bundle) =>
    bundle.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const hasChanges =
    effectiveIds.length !== selectedBundleIds.length ||
    effectiveIds.some((id, index) => id !== selectedBundleIds[index]);
  const locked = disabled || isSaving;

  function toggleBundle(bundleId: string, checked: boolean) {
    if (checked) {
      if (effectiveIds.length >= 10 || effectiveIds.includes(bundleId)) return;
      setDraftIds((current) => [...(current ?? selectedBundleIds), bundleId]);
      return;
    }
    if (effectiveIds.length <= 1) return;
    setDraftIds((current) =>
      (current ?? selectedBundleIds).filter((id) => id !== bundleId),
    );
  }

  function save() {
    if (effectiveIds.length < 1 || effectiveIds.length > 10 || !hasChanges) return;
    const formData = new FormData();
    formData.set("sessionId", sessionId);
    formData.set("knowledgeBundleIds", JSON.stringify(effectiveIds));
    startSaving(async () => {
      await updateChatKnowledgeSourcesAction(formData);
      setDraftIds(null);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-background/60 px-4 py-2">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <BookOpenCheck className="h-3.5 w-3.5" />
        Knowledge sources
      </div>
      {effectiveIds.map((id) => {
        const bundle = optionsById.get(id);
        if (!bundle) return null;
        return (
          <Badge key={id} variant="outline" className="gap-1 pr-1">
            <span className="max-w-44 truncate">{bundle.name}</span>
            {effectiveIds.length > 1 ? (
              <button
                aria-label={`Remove ${bundle.name}`}
                className="rounded-sm p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                disabled={locked}
                onClick={() => toggleBundle(id, false)}
                title={`Remove ${bundle.name}`}
                type="button"
              >
                <X className="h-3 w-3" />
              </button>
            ) : null}
          </Badge>
        );
      })}
      <DropdownMenu onOpenChange={(open) => !open && setQuery("")}>
        <DropdownMenuTrigger asChild>
          <Button disabled={locked} size="sm" variant="outline">
            <Plus className="h-3.5 w-3.5" />
            Add knowledge
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuLabel>Search up to 10 bundles</DropdownMenuLabel>
          <div className="px-2 pb-2">
            <input
              aria-label="Search knowledge bundles"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => event.stopPropagation()}
              placeholder="Search bundles"
              value={query}
            />
          </div>
          <DropdownMenuSeparator />
          <div className="max-h-64 overflow-y-auto">
            {filtered.map((bundle) => {
              const checked = effectiveIds.includes(bundle.id);
              return (
                <DropdownMenuCheckboxItem
                  checked={checked}
                  disabled={!checked && effectiveIds.length >= 10}
                  key={bundle.id}
                  onCheckedChange={(next) => toggleBundle(bundle.id, next === true)}
                  onSelect={(event) => event.preventDefault()}
                >
                  {bundle.name}
                </DropdownMenuCheckboxItem>
              );
            })}
            {filtered.length === 0 ? (
              <p className="px-2 py-3 text-sm text-muted-foreground">
                No matching knowledge bundles.
              </p>
            ) : null}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
      {hasChanges ? (
        <>
        <Button disabled={locked || effectiveIds.length === 0} onClick={save} size="sm">
            {isSaving ? "Saving..." : "Apply"}
          </Button>
          <Button
            disabled={locked}
            onClick={() => setDraftIds(null)}
            size="sm"
            variant="ghost"
          >
            Cancel
          </Button>
        </>
      ) : null}
      <span className="ml-auto text-xs text-muted-foreground">
        {effectiveIds.length}/10 selected
      </span>
    </div>
  );
}

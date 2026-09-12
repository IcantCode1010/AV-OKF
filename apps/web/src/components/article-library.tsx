"use client";

import Link from "next/link";
import { FilePenLine, PackageCheck, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { KnowledgeActionForm } from "./knowledge-action-form";

const PAGE_SIZE = 40;

export type ArticleLibraryRow = {
  articleId: string;
  revisionId: string | null;
  title: string;
  version: number | null;
  origin: string;
  approved: boolean;
  metadataStatus: "ready" | "classifying" | "needs_correction" | "not_applied";
  metadataLabel: string;
  selectedForEfb: boolean;
};

export function ArticleLibrary({ rows }: { rows: ArticleLibraryRow[] }) {
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const visible = useMemo(
    () =>
      rows.filter((row) =>
        `${row.title} ${row.origin} ${row.metadataLabel}`
          .toLowerCase()
          .includes(filter.trim().toLowerCase()),
      ),
    [filter, rows],
  );
  const selectable = visible.filter((row) => row.revisionId);
  const selectedApproved = rows.filter((row) => row.approved && row.revisionId && selected.includes(row.revisionId));
  const selectedDrafts = rows.filter((row) => !row.approved && row.revisionId && selected.includes(row.revisionId));
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const displayed = visible.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const allVisibleSelected =
    selectable.length > 0 && selectable.every((row) => selected.includes(row.revisionId!));

  function toggleAll() {
    const visibleIds = selectable.map((row) => row.revisionId!);
    setSelected((current) =>
      allVisibleSelected
        ? current.filter((id) => !visibleIds.includes(id))
        : [...new Set([...current, ...visibleIds])],
    );
  }

  return (
    <section className="overflow-hidden rounded-md border bg-card">
      <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-semibold">Published articles</h2>
          <p className="text-sm text-muted-foreground">
            {rows.length} articles · {rows.filter((row) => row.approved).length} approved
          </p>
        </div>
        <label className="relative block w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" aria-hidden="true" />
          <span className="sr-only">Search articles</span>
          <input
            value={filter}
            onChange={(event) => { setFilter(event.target.value); setPage(0); }}
            placeholder="Search articles"
            className="h-9 w-full rounded-md border bg-background pl-9 pr-3 text-sm"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/30 px-4 py-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} />
          Select all results
        </label>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">{selected.length} selected</span>
          {selectedDrafts.length > 0 && (
            <KnowledgeActionForm>
              <input type="hidden" name="action" value="approve-articles" />
              {selectedDrafts.map((row) => <input key={row.revisionId} type="hidden" name="revisionId" value={row.revisionId!} />)}
              <button className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">
                <PackageCheck className="size-4" aria-hidden="true" /> Approve {selectedDrafts.length} drafts
              </button>
            </KnowledgeActionForm>
          )}
          {selected.length > 0 && (
            <details className="relative">
              <summary className="inline-flex cursor-pointer list-none items-center gap-2 rounded-md border border-destructive/50 px-3 py-1.5 text-sm font-medium text-destructive hover:bg-destructive/10">
                <Trash2 className="size-4" aria-hidden="true" /> Delete selected
              </summary>
              <div className="absolute right-0 top-11 z-30 w-[min(24rem,calc(100vw-2rem))] rounded-md border border-destructive/40 bg-background p-4 shadow-lg">
                <p className="text-sm">This permanently deletes the selected articles, their revisions, visuals, classifications, and active EFB selections. Source documents, topic records, OKF bundles, and completed package history are preserved.</p>
                <label className="mt-3 flex items-start gap-2 text-sm font-medium">
                  <input type="checkbox" checked={deleteConfirmed} onChange={(event) => setDeleteConfirmed(event.target.checked)} />
                  I understand that {selected.length} selected articles will be permanently deleted.
                </label>
                <KnowledgeActionForm>
                  <input type="hidden" name="action" value="delete-articles" />
                  {selected.map((revisionId) => <input key={revisionId} type="hidden" name="revisionId" value={revisionId} />)}
                  <button disabled={!deleteConfirmed} className="mt-3 inline-flex items-center gap-2 rounded-md bg-destructive px-3 py-2 font-medium text-destructive-foreground disabled:cursor-not-allowed disabled:opacity-50">
                    <Trash2 className="size-4" aria-hidden="true" /> Delete {selected.length} articles
                  </button>
                </KnowledgeActionForm>
              </div>
            </details>
          )}
        </div>
      </div>

      <div className="max-h-[58vh] overflow-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="sticky top-0 z-10 bg-background text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="w-12 px-4 py-2"><span className="sr-only">Select</span></th>
              <th className="px-2 py-2 font-medium">Article</th>
              <th className="px-2 py-2 font-medium">Revision</th>
              <th className="px-2 py-2 font-medium">Article status</th>
              <th className="px-2 py-2 font-medium">EFB metadata</th>
              <th className="w-24 px-4 py-2 text-right font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {displayed.map((row) => {
              const canSelect = Boolean(row.revisionId);
              return (
                <tr key={row.articleId} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-3 align-middle">
                    <input
                      type="checkbox"
                      aria-label={`Select ${row.title}`}
                      disabled={!canSelect}
                      checked={Boolean(row.revisionId && selected.includes(row.revisionId))}
                      onChange={(event) => {
                        if (!row.revisionId) return;
                        setSelected((current) =>
                          event.target.checked
                            ? [...new Set([...current, row.revisionId!])]
                            : current.filter((id) => id !== row.revisionId),
                        );
                      }}
                    />
                  </td>
                  <td className="px-2 py-3">
                    <Link href={`/articles/${row.articleId}`} className="font-medium hover:underline">
                      {row.title}
                    </Link>
                    <p className="text-xs text-muted-foreground">{row.origin}</p>
                  </td>
                  <td className="px-2 py-3">{row.version ? `v${row.version}` : "None"}</td>
                  <td className="px-2 py-3">
                    <span className={row.approved ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}>
                      {row.approved ? "Approved" : "Draft"}
                    </span>
                  </td>
                  <td className="px-2 py-3">
                    <span className={row.metadataStatus === "ready" ? "text-emerald-700 dark:text-emerald-400" : row.metadataStatus === "needs_correction" ? "text-destructive" : "text-muted-foreground"}>
                      {row.metadataLabel}
                    </span>
                    {row.selectedForEfb && <p className="text-xs text-muted-foreground">In package selection</p>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/articles/${row.articleId}`} className="inline-flex items-center gap-1 font-medium hover:underline">
                      <FilePenLine className="size-4" aria-hidden="true" /> Edit
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!visible.length && <p className="p-8 text-center text-sm text-muted-foreground">No articles match this search.</p>}
      </div>

      {visible.length > PAGE_SIZE && (
        <div className="flex items-center justify-between gap-3 border-t px-4 py-3 text-sm">
          <span className="text-muted-foreground">
            {currentPage * PAGE_SIZE + 1}-{Math.min((currentPage + 1) * PAGE_SIZE, visible.length)} of {visible.length}
          </span>
          <div className="flex gap-2">
            <button type="button" disabled={currentPage === 0} onClick={() => setPage((value) => Math.max(0, value - 1))} className="rounded-md border px-3 py-1.5 disabled:opacity-40">Previous</button>
            <button type="button" disabled={currentPage >= pageCount - 1} onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))} className="rounded-md border px-3 py-1.5 disabled:opacity-40">Next</button>
          </div>
        </div>
      )}

      <div className="border-t bg-background p-4">
        <KnowledgeActionForm>
          <input type="hidden" name="action" value="prepare-and-export-efb" />
          {selectedApproved.map((row) => <input key={row.revisionId} type="hidden" name="revisionId" value={row.revisionId!} />)}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              {selectedDrafts.length
                ? `${selectedDrafts.length} selected drafts must be approved before export.`
                : "Metadata is validated before the separate Project EFB package is created."}
            </p>
            <button disabled={!selectedApproved.length} className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50">
              <PackageCheck className="size-4" aria-hidden="true" />
              Build EFB package ({selectedApproved.length} approved)
            </button>
          </div>
        </KnowledgeActionForm>
      </div>
    </section>
  );
}

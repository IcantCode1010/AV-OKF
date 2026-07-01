import type { RetrievalResult } from "@/lib/rag-types";

export function SearchResults({
  query,
  results,
}: {
  query: string;
  results: RetrievalResult[];
}) {
  if (!query) {
    return (
      <p className="text-sm text-muted-foreground">
        Enter a query to search indexed document chunks.
      </p>
    );
  }

  if (results.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No indexed chunks matched this query.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {results.map((result) => (
        <article key={result.chunkId} className="rounded-md border p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium">{result.documentTitle}</h2>
            <span className="text-xs text-muted-foreground">
              Pages {result.pageStart}-{result.pageEnd}
            </span>
          </div>
          <p className="mt-3 line-clamp-4 text-sm text-muted-foreground">
            {result.text}
          </p>
        </article>
      ))}
    </div>
  );
}

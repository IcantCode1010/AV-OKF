import { SearchForm } from "@/components/search-form";
import { SearchResults } from "@/components/search-results";
import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import { retrieveDocuments } from "@/lib/rag-backend";

export const dynamic = "force-dynamic";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const params = await searchParams;
  const context = await requireAuthWorkspaceContext();
  const query = params.q?.trim() ?? "";
  const results =
    query.length > 0
      ? await retrieveDocuments({
          mode: "hybrid",
          query,
          topK: 10,
          workspaceId: context.workspaceId,
        })
      : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Search</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Search extracted document chunks with page-level citations.
        </p>
      </div>
      <SearchForm query={query} />
      <SearchResults query={query} results={results} />
    </div>
  );
}

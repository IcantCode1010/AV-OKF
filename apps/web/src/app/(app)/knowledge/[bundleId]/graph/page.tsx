import { notFound } from "next/navigation";
import Link from "next/link";

import { BundleWorkspaceHeader } from "@/components/knowledge-explorer/bundle-workspace-header";
import { EntityGraphExplorer, KnowledgeGraphExplorer } from "@/components/knowledge-explorer/knowledge-explorer";
import { Button } from "@/components/ui/button";
import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import { loadEntityGraphSnapshot } from "@/lib/entity-graph-view";
import { getKnowledgeBundle, resolveKnowledgeBundleRoot } from "@/lib/knowledge-bundles";
import { loadOkfExplorerSnapshot } from "@/lib/okf-explorer";

export const dynamic = "force-dynamic";

export default async function KnowledgeGraphPage({ params, searchParams }: {
  params: Promise<{ bundleId: string }>;
  searchParams: Promise<{ file?: string; mode?: string }>;
}) {
  const [{ bundleId }, query, context] = await Promise.all([params, searchParams, requireAuthWorkspaceContext()]);
  const bundle = await getKnowledgeBundle({ bundleId, context });
  if (!bundle) notFound();
  const snapshot = await loadOkfExplorerSnapshot({
    knowledgeBundleId: bundle.id,
    knowledgeRoot: resolveKnowledgeBundleRoot({ bundleId: bundle.id, workspaceId: context.workspaceId }),
    requestedFile: query.file,
    workspaceId: context.workspaceId,
  });
  const mode = query.mode === "entities" || query.mode === "attention" ? query.mode : "published";
  const entitySnapshot = mode === "published" ? null : await loadEntityGraphSnapshot({
    attentionOnly: mode === "attention",
    knowledgeBundleId: bundle.id,
    workspaceId: context.workspaceId,
  });
  return (
    <div className="flex h-full min-h-0 flex-col">
      <BundleWorkspaceHeader bundle={bundle} counts={{ concepts: snapshot.nodes.length, files: snapshot.files.length, relations: snapshot.edges.length }} file={snapshot.selectedFile} view="graph" />
      <div className="flex items-center gap-1 border-b border-border px-4 py-2">
        {[["published", "Published knowledge"], ["entities", "Entity map"], ["attention", "Needs attention"]].map(([value, label]) => (
          <Button asChild key={value} size="sm" variant={mode === value ? "secondary" : "ghost"}><Link href={`/knowledge/${encodeURIComponent(bundle.id)}/graph?mode=${value}`}>{label}</Link></Button>
        ))}
      </div>
      {entitySnapshot ? <EntityGraphExplorer mode={mode as "attention" | "entities"} snapshot={entitySnapshot} /> : <KnowledgeGraphExplorer browseHref={`/knowledge/${encodeURIComponent(bundle.id)}/browse`} snapshot={snapshot} />}
    </div>
  );
}

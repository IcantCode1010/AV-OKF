import { notFound } from "next/navigation";

import { GraphNetworkExplorer } from "@/components/knowledge-explorer/graph-network-explorer";
import { buildGraphNetwork } from "@/lib/graph-network";
import { isProductionBackend } from "@/lib/production-document-service";
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
  const mode = query.mode === "published" || query.mode === "attention" ? query.mode : "network";
  const entitySnapshot = isProductionBackend() ? await loadEntityGraphSnapshot({
    knowledgeBundleId: bundle.id,
    workspaceId: context.workspaceId,
  }) : { nodes: [], edges: [], summary: { attention: 0, entities: 0, occurrences: 0, published: 0 } };
  const network = buildGraphNetwork({ entities: entitySnapshot, published: snapshot });
  return (
    <div className="flex h-full min-h-0 flex-col">
      <GraphNetworkExplorer key={bundle.id} bundleId={bundle.id} initialScope={mode} network={network} />
    </div>
  );
}

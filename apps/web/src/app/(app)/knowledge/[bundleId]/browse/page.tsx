import { notFound } from "next/navigation";

import { BundleWorkspaceHeader } from "@/components/knowledge-explorer/bundle-workspace-header";
import { KnowledgeBrowse } from "@/components/knowledge-explorer/knowledge-explorer";
import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import { getKnowledgeBundle, resolveKnowledgeBundleRoot } from "@/lib/knowledge-bundles";
import { loadOkfExplorerSnapshot } from "@/lib/okf-explorer";

export const dynamic = "force-dynamic";

export default async function KnowledgeBrowsePage({ params, searchParams }: {
  params: Promise<{ bundleId: string }>;
  searchParams: Promise<{ file?: string }>;
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
  return (
    <div className="flex h-full min-h-0 flex-col">
      <BundleWorkspaceHeader bundle={bundle} counts={{ concepts: snapshot.nodes.length, files: snapshot.files.length, relations: snapshot.edges.length }} file={snapshot.selectedFile} view="browse" />
      <KnowledgeBrowse snapshot={snapshot} />
    </div>
  );
}

import { Activity } from "lucide-react";
import { notFound } from "next/navigation";

import { BundleActivityFeed } from "@/components/bundle-activity-feed";
import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import { buildBundleActivityProgressSnapshot, getBundleActivitySnapshot } from "@/lib/bundle-activity";
import { getKnowledgeBundle } from "@/lib/knowledge-bundles";

export const dynamic = "force-dynamic";

export default async function BundleActivityPage({ params }: { params: Promise<{ bundleId: string }> }) {
  const { bundleId } = await params;
  const context = await requireAuthWorkspaceContext();
  const bundle = await getKnowledgeBundle({ bundleId, context });
  if (!bundle) notFound();
  const snapshot = await getBundleActivitySnapshot({ bundleId, context });

  return (
    <div className="w-full space-y-6 p-4 sm:p-6">
      <header className="flex items-start gap-3 border-b pb-5">
        <div className="rounded-md border bg-muted p-2"><Activity className="h-5 w-5" aria-hidden="true" /></div>
        <div><p className="text-xs font-medium uppercase text-muted-foreground">{bundle.name}</p><h1 className="text-2xl font-semibold">Activity</h1><p className="mt-1 text-sm text-muted-foreground">Processing, review, export, and relation outcomes for this knowledge bundle.</p></div>
      </header>
      <BundleActivityFeed bundleId={bundle.id} initialSnapshot={buildBundleActivityProgressSnapshot(snapshot)} />
    </div>
  );
}

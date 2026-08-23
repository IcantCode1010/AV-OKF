import Link from "next/link";
import { ArrowRight, ListChecks, Sparkles } from "lucide-react";
import { notFound } from "next/navigation";

import { BundleWorkflowView } from "@/components/bundle-workflow-view";
import { Button } from "@/components/ui/button";
import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import { getBundleWorkflowSnapshot } from "@/lib/bundle-workflow";
import { getKnowledgeBundle } from "@/lib/knowledge-bundles";

export const dynamic = "force-dynamic";

export default async function BundleWorkflowPage({
  params,
}: {
  params: Promise<{ bundleId: string }>;
}) {
  const [{ bundleId }, context] = await Promise.all([params, requireAuthWorkspaceContext()]);
  const bundle = await getKnowledgeBundle({ bundleId, context });
  if (!bundle) notFound();
  const snapshot = await getBundleWorkflowSnapshot({ bundleId: bundle.id, context });

  return (
    <div className="mx-auto w-full max-w-5xl space-y-7">
      <header className="flex items-start gap-3 border-b pb-5">
        <div className="rounded-md border bg-muted p-2"><ListChecks className="size-5" aria-hidden="true" /></div>
        <div>
          <p className="text-xs font-medium uppercase text-muted-foreground">{bundle.name}</p>
          <h1 className="text-2xl font-semibold">Knowledge workflow</h1>
          <p className="mt-1 text-sm text-muted-foreground">Current progress from source documents through published knowledge, connections, and retrieval testing.</p>
        </div>
      </header>
      <BundleWorkflowView bundleId={bundle.id} snapshot={snapshot} />
      <section className="flex flex-col gap-4 border-y border-border py-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Sparkles className="mt-0.5 size-5 text-primary" />
          <div><p className="text-xs font-semibold uppercase text-muted-foreground">Optional knowledge expansion</p><h2 className="mt-1 font-medium">Discover additional topics</h2><p className="mt-1 text-sm text-muted-foreground">Run a separate bounded analysis across approved concepts. It does not block this workflow or publish anything automatically.</p></div>
        </div>
        <Button asChild className="shrink-0" variant="outline"><Link href={`/knowledge/${bundle.id}/topic-expansion`}>Open topic expansion<ArrowRight /></Link></Button>
      </section>
    </div>
  );
}

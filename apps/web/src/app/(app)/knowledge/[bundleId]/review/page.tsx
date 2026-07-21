import Link from "next/link";
import { ArrowLeft, Layers3 } from "lucide-react";
import { notFound } from "next/navigation";

import { BulkTopicReviewList } from "@/components/bulk-topic-review-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import { listBulkReviewTopics } from "@/lib/bulk-topic-approval";
import { getKnowledgeBundle } from "@/lib/knowledge-bundles";

export const dynamic = "force-dynamic";

export default async function BulkTopicReviewPage({ params, searchParams }: {
  params: Promise<{ bundleId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const [{ bundleId }, query, context] = await Promise.all([params, searchParams, requireAuthWorkspaceContext()]);
  const bundle = await getKnowledgeBundle({ bundleId, context });
  if (!bundle) notFound();
  const topics = await listBulkReviewTopics({ bundleId, context });
  return (
    <div className="space-y-5">
      <Button asChild size="sm" variant="ghost"><Link href={`/knowledge/${bundle.id}`}><ArrowLeft className="size-4" />Back to bundle</Link></Button>
      <header className="flex flex-col gap-3 border-b border-border pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2"><Layers3 className="size-5 text-primary" /><Badge variant="outline">{bundle.name}</Badge></div>
          <h1 className="mt-3 text-2xl font-semibold">Bulk topic approval and export</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">Review enriched content, select topics intentionally, then run one preflight before anything is approved.</p>
        </div>
      </header>
      {query.error ? <div className="border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-100">{query.error}</div> : null}
      <BulkTopicReviewList bundleId={bundle.id} topics={topics} />
    </div>
  );
}

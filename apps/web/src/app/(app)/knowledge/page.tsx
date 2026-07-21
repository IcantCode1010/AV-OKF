import Link from "next/link";
import { BookOpenCheck, Clock, FileText, FolderOpen, Plus } from "lucide-react";

import { KnowledgeBundleDeleteControl } from "@/components/knowledge-bundle-delete-control";
import { KnowledgeBundleDeletionPoller } from "@/components/knowledge-bundle-deletion-poller";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import { getOkfBundleSummary } from "@/lib/okf-bundle";
import { listKnowledgeBundles, resolveKnowledgeBundleRoot } from "@/lib/knowledge-bundles";
import { getKnowledgeBundleDeletionStatusSnapshot } from "@/lib/knowledge-bundle-deletion";
import { isProductionBackend } from "@/lib/production-document-service";
import { createKnowledgeBundleAction, retryKnowledgeBundleDeletionAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function KnowledgePage() {
  const context = await requireAuthWorkspaceContext();
  const [bundles, deletionSnapshot] = await Promise.all([
    listKnowledgeBundles(context),
    getKnowledgeBundleDeletionStatusSnapshot(context),
  ]);
  const summaries = await Promise.all(
    bundles.map(async (bundle) => ({
      bundle,
      summary: await getOkfBundleSummary(resolveKnowledgeBundleRoot({
        bundleId: bundle.id,
        workspaceId: context.workspaceId,
      })),
    })),
  );

  return (
    <div className="space-y-6">
      <KnowledgeBundleDeletionPoller
        active={deletionSnapshot.active}
        fingerprint={deletionSnapshot.fingerprint}
      />
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <Badge variant="secondary">Knowledge vault</Badge>
          <h1 className="mt-3 text-3xl font-semibold">Knowledge bundles</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Keep unrelated domains isolated in portable OKF bundles with independent profiles, sources, relations, and chats.
          </p>
        </div>
        <Badge variant="outline">{bundles.length} bundle{bundles.length === 1 ? "" : "s"}</Badge>
      </div>

      {deletionSnapshot.jobs.length > 0 ? (
        <Card>
          <CardHeader><CardTitle>Bundle deletion</CardTitle><CardDescription>Knowledge cleanup runs in the background. Source documents remain available as Unassigned.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            {deletionSnapshot.jobs.map((job) => (
              <div className="flex flex-col gap-3 border border-border p-3 sm:flex-row sm:items-center sm:justify-between" key={job.id}>
                <div>
                  <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{job.bundleName}</span><Badge variant={job.status === "failed" ? "destructive" : "outline"}>{job.status}</Badge></div>
                  <p className="mt-1 text-xs text-muted-foreground">{job.documentCount} preserved document{job.documentCount === 1 ? "" : "s"}</p>
                  {job.errorMessage ? <p className="mt-1 text-xs text-destructive">{job.errorMessage}</p> : null}
                </div>
                {job.status === "failed" ? (
                  <form action={retryKnowledgeBundleDeletionAction}><input name="jobId" type="hidden" value={job.id} /><PendingSubmitButton pendingLabel="Retrying...">Retry deletion</PendingSubmitButton></form>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {bundles.length === 0 ? (
        <div className="flex min-h-56 flex-col items-center justify-center border border-dashed border-border p-8 text-center">
          <FolderOpen className="size-8 text-muted-foreground" />
          <p className="mt-3 font-medium">The knowledge vault is empty</p>
          <p className="mt-1 text-sm text-muted-foreground">Create a bundle before uploading or assigning documents.</p>
        </div>
      ) : <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {summaries.map(({ bundle, summary }) => (
          <Card key={bundle.id}>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle>{bundle.name}</CardTitle>
                  <CardDescription className="mt-1">{bundle.description || "No description"}</CardDescription>
                </div>
                <Badge variant="outline">{bundle.profile.name}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-2 text-xs">
                <Metric icon={FileText} label="Files" value={summary.fileCount} />
                <Metric icon={BookOpenCheck} label="Concepts" value={summary.fileCount - summary.groupCounts.reserved} />
                <Metric icon={Clock} label="Profile" value={`v${bundle.activeProfileVersion}`} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild><Link href={`/knowledge/${bundle.id}`}><FolderOpen className="size-4" />Open bundle</Link></Button>
                {isProductionBackend() ? <KnowledgeBundleDeleteControl bundleId={bundle.id} bundleName={bundle.name} documentCount={bundle.documentCount} /> : <Button disabled size="sm" variant="outline">Deletion unavailable locally</Button>}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Plus className="size-4" />New knowledge bundle</CardTitle>
          <CardDescription>Clone an immutable template. Profile changes become versioned drafts after creation.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={createKnowledgeBundleAction} className="grid gap-4 lg:grid-cols-[1fr_1.5fr_14rem_auto] lg:items-end">
            <div className="space-y-2"><Label htmlFor="name">Name</Label><Input id="name" name="name" required placeholder="Automobile Knowledge" /></div>
            <div className="space-y-2"><Label htmlFor="description">Description</Label><Input id="description" name="description" placeholder="Vehicle procedures and reference material" /></div>
            <div className="space-y-2"><Label htmlFor="template">Template</Label><select className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" id="template" name="template"><option value="generic">Generic</option><option value="aviation">Aviation</option></select></div>
            <PendingSubmitButton pendingLabel="Creating...">Create bundle</PendingSubmitButton>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof FileText; label: string; value: number | string }) {
  return <div className="border border-border p-3"><Icon className="mb-2 size-4 text-muted-foreground" /><div className="font-medium">{value}</div><div className="text-muted-foreground">{label}</div></div>;
}

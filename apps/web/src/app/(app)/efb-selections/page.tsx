import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import { getPrisma } from "@/lib/prisma";
import { knowledgeFeature } from "@/lib/knowledge/contracts";
import { KnowledgeActionForm } from "@/components/knowledge-action-form";
import { EfbExportProgress } from "@/components/efb-export-progress";
import { publisherIsConfigured } from "@/lib/efb-publisher/config";
export default async function EfbSelections() {
  if (!knowledgeFeature("shared") || !knowledgeFeature("export")) notFound();
  const context = await requireAuthWorkspaceContext(),
    db = getPrisma();
  const releases = await db.knowledgeExportRelease.findMany({
    where: { workspaceId: context.workspaceId },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  const publications = await db.knowledgeReleaseRun.findMany({ where: { workspaceId: context.workspaceId, triggerKey: { in: releases.map(r => `efb-export:${context.workspaceId}:${r.id}`) } } });
  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">EFB packages</h1>
          <p className="text-sm text-muted-foreground">
            Your latest packages, newest first. Push a ready package to Supabase to make it available in the EFB app.
          </p>
        </div>
        <Link className="shrink-0 rounded border px-3 py-2 text-sm" href="/articles">
          Create a package from articles
        </Link>
      </div>
      <EfbExportProgress releases={publications.map(r => ({ id: r.id, status: r.status, stage: r.currentStage, createdAt: r.createdAt.toISOString(), itemCount: Array.isArray(r.selectionSnapshot) ? r.selectionSnapshot.length : 0 }))} publication />
      <EfbExportProgress releases={releases.map((release) => ({ id: release.id, status: release.status, createdAt: release.createdAt.toISOString(), itemCount: Array.isArray(release.selectionSnapshot) ? release.selectionSnapshot.length : 0 }))} />
      <h2 className="text-xl font-semibold">Latest packages</h2>
      {!publisherIsConfigured() && <p role="alert" className="rounded border p-3">EFB delivery connection needs setup. Configure the authorized EFB publisher URL and credentials in the web and worker services before pushing packages.</p>}
      {releases.length === 0 && <p className="rounded border p-4 text-muted-foreground">No EFB packages yet. Select approved articles in the article library and choose Build EFB package.</p>}
      {releases.map((r) => {
        const publication = publications.find(p => p.triggerKey === `efb-export:${context.workspaceId}:${r.id}`);
        const signed = Boolean((r.result as { manifest?: { signature?: { value?: string } } } | null)?.manifest?.signature?.value);
        return (
        <div key={r.id} className="rounded border p-3">
          <p>
            {r.createdAt.toISOString()} · {r.status}
          </p>
          {r.error && <p role="alert">{r.error.replaceAll("_", " ")}</p>}
          {r.status==="queued" && <KnowledgeActionForm><input type="hidden" name="action" value="cancel-export"/><input type="hidden" name="releaseId" value={r.id}/><button className="rounded border p-2">Cancel queued export</button></KnowledgeActionForm>}
          {(r.result as {failures?:Array<{articleId:string;reason:string}>}|null)?.failures?.map(f=><p key={f.articleId}><Link href={`/articles/${f.articleId}`}>Review article</Link>: {f.reason.replaceAll("_"," ")}</p>)}
          {r.status === "exported" && (
            <div className="space-y-2">
            <p>{publication?.status === "completed" ? "Pushed to Supabase and activated in EFB." : publication ? `EFB delivery: ${publication.status.replaceAll("_", " ")} · ${publication.currentStage.replaceAll("_", " ")}` : signed ? "Package ready · Not yet pushed to EFB" : "Rebuild required · This package was created without a digital signature."}</p>
            {publication?.status === "failed" && <p role="alert">Push failed at {publication.currentStage.replaceAll("_", " ")}. {publication.errorCode?.replaceAll("_", " ")}. Retry resumes completed steps.</p>}
            {signed && (!publication || ["failed", "awaiting_publication", "awaiting_activation"].includes(publication.status)) && <KnowledgeActionForm><input type="hidden" name="action" value="publish-export"/><input type="hidden" name="releaseId" value={r.id}/><button className="rounded border px-3 py-2">{publication ? "Retry push to EFB app" : "Push to EFB app"}</button><p className="text-sm text-muted-foreground">Uploads to Supabase and activates the resulting EFB catalog for users.</p></KnowledgeActionForm>}
            {!signed && publication?.status !== "completed" && <Link className="block underline" href="/articles">Select the articles and build a signed package</Link>}
            <a className="underline" href={`/api/knowledge-exports/${r.id}`}>
              Download validated package
            </a>
            </div>
          )}
        </div>
      ); })}
    </div>
  );
}

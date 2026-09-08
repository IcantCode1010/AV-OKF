import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import { getPrisma } from "@/lib/prisma";
import { knowledgeFeature } from "@/lib/knowledge/contracts";
import { assertArticleSourcesCurrent } from "@/lib/knowledge/editorial";
import { KnowledgeActionForm } from "@/components/knowledge-action-form";
import { EFB_AIRCRAFT_FAMILIES } from "@/lib/efb-aircraft-catalog";
import { selectionMetadataSchema } from "@/lib/knowledge/export";
import { EfbBulkControls } from "@/components/efb-bulk-controls";
export default async function EfbSelections() {
  if (!knowledgeFeature("shared") || !knowledgeFeature("export")) notFound();
  const context = await requireAuthWorkspaceContext(),
    db = getPrisma();
  const selections = await db.knowledgeEfbSelection.findMany({
    where: { workspaceId: context.workspaceId },
    orderBy: { createdAt: "asc" },
  });
  const releases = await db.knowledgeExportRelease.findMany({
    where: { workspaceId: context.workspaceId },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  const rows = await Promise.all(
    selections.map(async (s) => {
      const revision = await db.knowledgeArticleRevision.findFirst({
        where: { id: s.revisionId, workspaceId: context.workspaceId },
      });
      let available = true;
      try {
        await assertArticleSourcesCurrent(context, s.revisionId);
      } catch {
        available = false;
      }
      available=available && !!revision?.approval;
      const visuals = await db.knowledgeVisual.findMany({
        where: {
          workspaceId: context.workspaceId,
          articleRevisionId: s.revisionId,
        },
        select: { id: true, caption: true, reviewedAt: true },
      });
      const parsedMetadata = selectionMetadataSchema.safeParse(s.metadata);
      return {
        s,
        revision,
        available,
        visuals,
        metadata: parsedMetadata.success ? parsedMetadata.data : null,
      };
    }),
  );
  const candidates=await db.knowledgeArticle.findMany({where:{workspaceId:context.workspaceId},include:{revisions:{orderBy:{version:"desc"},take:1}},take:500});
  const classifications=process.env.AV_OKF_EFB_CLASSIFICATION_ENABLED==="true"?await db.knowledgeEfbClassification.findMany({where:{workspaceId:context.workspaceId,revisionId:{in:candidates.flatMap(a=>a.revisions.map(r=>r.id))}},orderBy:{createdAt:"desc"}}):[];
  const candidateRows=candidates.flatMap(a=>a.revisions.map(r=>{
    const c=classifications.find(c=>c.revisionId===r.id),result=c?.result as {metadata?:{aircraftFamily:string;audiences:string[];ataChapter:string|null;qrhTargetId:string|null}}|undefined;
    return {id:r.id,title:(r.body as {title:string}).title,version:r.version,aircraft:result?.metadata?.aircraftFamily??"",audience:result?.metadata?.audiences.join(" / ")??"",placement:[result?.metadata?.ataChapter,result?.metadata?.qrhTargetId,c?.status??"Not classified"].filter(Boolean).join(" · "),eligible:true,ready:!!r.approval && c?.status==="ready"};
  }));
  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <h1 className="text-2xl font-semibold">EFB selections</h1>
      <p>
        Choose aircraft, audience, and the matching Project EFB placement for
        each article. Export creates a signed prototype cloud package; it does
        not activate it in EFB.
      </p>
      <Link className="underline" href="/articles">
        Choose articles
      </Link>
      {process.env.AV_OKF_EFB_CLASSIFICATION_ENABLED==="true" && <EfbBulkControls rows={candidateRows} action="classify-batch" label="Classify selected revisions"/>}
      {process.env.AV_OKF_EFB_CLASSIFICATION_ENABLED==="true" && <EfbBulkControls rows={candidateRows.map(r=>({...r,eligible:r.ready}))} action="select-ready-batch" label="Add classified ready revisions to EFB selections"/>}
      {rows.length === 0 ? (
        <p>No articles selected.</p>
      ) : (
        rows.map(({ s, revision, available, visuals, metadata }) => (
          <section key={s.id} className="space-y-3 rounded border p-4">
            <Link
              className="font-semibold underline"
              href={`/articles/${s.articleId}`}
            >
              {(revision?.body as { title?: string })?.title ??
                "Unavailable article"}
            </Link>
            <p>
              {available
                ? `${revision?.approval ? "Approved" : "Draft"} · Selected for prototype EFB package`
                : "Source changed or unavailable — export blocked"}
            </p>
            {metadata ? (
              <dl className="grid gap-2 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-muted-foreground">Aircraft</dt>
                  <dd className="font-medium">
                    {formatAircraft(metadata.aircraftFamily, metadata.aircraftTypeIds)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Placement</dt>
                  <dd className="font-medium">
                    {[
                      metadata.ataChapter ? `ATA ${metadata.ataChapter}` : null,
                      metadata.qrhTargetId ? `QRH ${formatTarget(metadata.qrhTargetId)}` : null,
                    ].filter(Boolean).join(" · ")}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Audience</dt>
                  <dd className="font-medium">
                    {metadata.audiences.map(capitalize).join(" and ")}
                  </dd>
                </div>
              </dl>
            ) : (
              <p role="alert">Update this selection before exporting.</p>
            )}
            <p>{visuals.length} supporting visuals</p>
            <ul>
              {visuals.map((v) => (
                <li key={v.id}>
                  {v.caption} · {v.reviewedAt ? "reviewed" : "review required"}
                </li>
              ))}
            </ul>
            <KnowledgeActionForm>
              <input type="hidden" name="action" value="unselect" />
              <input type="hidden" name="selectionId" value={s.id} />
              <button className="rounded border px-3 py-2">
                Remove from selection
              </button>
            </KnowledgeActionForm>
          </section>
        ))
      )}
      {rows.length>0 && <EfbBulkControls rows={rows.map(r=>({id:r.s.id,title:(r.revision?.body as {title?:string})?.title??"Unavailable",version:r.revision?.version??0,aircraft:r.metadata?.aircraftFamily??"",audience:r.metadata?.audiences.join(" / ")??"",placement:[r.metadata?.ataChapter,r.metadata?.qrhTargetId].filter(Boolean).join(" / "),eligible:r.available && !!r.metadata}))} action="export" label="Validate and export selected revisions"/>}
      <h2 className="text-xl font-semibold">Export history</h2>
      {releases.map((r) => (
        <div key={r.id} className="rounded border p-3">
          <p>
            {r.createdAt.toISOString()} · {r.status}
          </p>
          {r.error && <p role="alert">{r.error.replaceAll("_", " ")}</p>}
          {r.status==="queued" && <KnowledgeActionForm><input type="hidden" name="action" value="cancel-export"/><input type="hidden" name="releaseId" value={r.id}/><button className="rounded border p-2">Cancel queued export</button></KnowledgeActionForm>}
          {(r.result as {failures?:Array<{articleId:string;reason:string}>}|null)?.failures?.map(f=><p key={f.articleId}><Link href={`/articles/${f.articleId}`}>Review article</Link>: {f.reason.replaceAll("_"," ")}</p>)}
          {r.status === "exported" && (
            <a className="underline" href={`/api/knowledge-exports/${r.id}`}>
              Download validated package
            </a>
          )}
        </div>
      ))}
    </div>
  );
}

function formatAircraft(familyId: string, typeIds: string[]) {
  const family = EFB_AIRCRAFT_FAMILIES.find((item) => item.id === familyId);
  const types = typeIds.map((typeId) =>
    family?.types.find((item) => item.id === typeId)?.label ?? typeId,
  );
  return [family?.label ?? familyId, ...types].join(" · ");
}

function capitalize(value: string) {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function formatTarget(value: string) {
  return value.split("-").map(capitalize).join(" ");
}

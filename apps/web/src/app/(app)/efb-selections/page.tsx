import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import { getPrisma } from "@/lib/prisma";
import { knowledgeFeature } from "@/lib/knowledge/contracts";
import { assertArticleSourcesCurrent } from "@/lib/knowledge/editorial";
import { KnowledgeActionForm } from "@/components/knowledge-action-form";
import { EFB_AIRCRAFT_FAMILIES } from "@/lib/efb-aircraft-catalog";
import { selectionMetadataSchema } from "@/lib/knowledge/export";
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
  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <h1 className="text-2xl font-semibold">EFB selections</h1>
      <p>
        Choose the aircraft and audience for each selected article. Export
        creates a validated prototype package; it does not activate it in EFB.
      </p>
      <Link className="underline" href="/articles">
        Choose articles
      </Link>
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
                ? "Approved · Selected for EFB"
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
                  <dt className="text-muted-foreground">ATA chapter</dt>
                  <dd className="font-medium">ATA {metadata.ataChapter}</dd>
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
      {rows.length > 0 && rows.every((r) => r.available && r.metadata) && (
        <KnowledgeActionForm>
          <input type="hidden" name="action" value="export" />
          <button className="rounded bg-primary px-4 py-2 text-primary-foreground">
            Validate and export topic package
          </button>
        </KnowledgeActionForm>
      )}
      <h2 className="text-xl font-semibold">Export history</h2>
      {releases.map((r) => (
        <div key={r.id} className="rounded border p-3">
          <p>
            {r.createdAt.toISOString()} · {r.status}
          </p>
          {r.error && <p role="alert">{r.error.replaceAll("_", " ")}</p>}
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

import type { AuthWorkspaceContext } from "@/lib/auth-workspace";
import { assertArticleSourcesCurrent } from "@/lib/knowledge/editorial";
import { getBuilderCorpus } from "@/lib/topic-builder";
import { getPrisma } from "@/lib/prisma";
export async function ArticleSourceStatus({
  context,
  revisionId,
}: {
  context: AuthWorkspaceContext;
  revisionId: string;
}) {
  let changed = false;
  try {
    await assertArticleSourcesCurrent(context, revisionId);
  } catch {
    changed = true;
  }
  if (!changed) return null;
  return (
    <p role="status" className="rounded border border-amber-500 p-3">
      Source evidence has changed or is unavailable. This is a historical
      revision. Review a new draft before exporting it.
    </p>
  );
}
export async function RecipeSourceStatus({
  workspaceId,
  recipeId,
  collectionIds,
  documentIds,
  fingerprint,
}: {
  workspaceId: string;
  recipeId: string;
  collectionIds: string[];
  documentIds: string[];
  fingerprint?: string;
}) {
  if (!fingerprint) return null;
  let status: "current" | "changed" | "unavailable" = "current";
  try {
    const corpus = await getBuilderCorpus(
      workspaceId,
      collectionIds,
      documentIds,
    );
    if (corpus.fingerprint !== fingerprint) status = "changed";
    const latest=await getPrisma().topicBuilderRun.findFirst({where:{workspaceId,recipeId},orderBy:{createdAt:"desc"},select:{result:true}});
    const applicabilityFingerprint=(latest?.result as {applicabilityAudit?:{metadataFingerprint?:string}}|null)?.applicabilityAudit?.metadataFingerprint;
    if(applicabilityFingerprint&&applicabilityFingerprint!==corpus.applicabilityFingerprint)status="changed";
  } catch {
    status = "unavailable";
  }
  if (status === "current") return null;
  return <p className="rounded border border-amber-500 p-3">
    {status === "changed"
      ? "The selected sources have changed. Refresh this recipe to assess the new evidence; approved content will stay unchanged."
      : "Some selected sources are unavailable or still processing. Check source readiness before refreshing."}
  </p>;
}

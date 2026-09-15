import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import { getKnowledgeBundle } from "@/lib/knowledge-bundles";
import { getRelationProgressSnapshot } from "@/lib/relation-progress";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ bundleId: string }> }) {
  const { bundleId } = await params;
  const context = await requireAuthWorkspaceContext();
  if (!await getKnowledgeBundle({ bundleId, context })) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json(await getRelationProgressSnapshot({ bundleId, context }), { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

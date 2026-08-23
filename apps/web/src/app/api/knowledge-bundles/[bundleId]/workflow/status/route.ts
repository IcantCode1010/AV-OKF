import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import { getBundleWorkflowSnapshot } from "@/lib/bundle-workflow";
import { getKnowledgeBundle } from "@/lib/knowledge-bundles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ bundleId: string }> },
) {
  const { bundleId } = await params;
  const context = await requireAuthWorkspaceContext();
  const bundle = await getKnowledgeBundle({ bundleId, context });
  if (!bundle) return Response.json({ error: "not_found" }, { status: 404 });
  const snapshot = await getBundleWorkflowSnapshot({ bundleId: bundle.id, context });
  return Response.json(
    { active: snapshot.active, fingerprint: snapshot.fingerprint },
    { headers: { "Cache-Control": "private, no-store, max-age=0" } },
  );
}

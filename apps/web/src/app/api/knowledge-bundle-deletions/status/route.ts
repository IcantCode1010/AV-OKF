import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import { buildKnowledgeBundleDeletionProgressSnapshot, getKnowledgeBundleDeletionStatusSnapshot } from "@/lib/knowledge-bundle-deletion";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const snapshot = await getKnowledgeBundleDeletionStatusSnapshot(
    await requireAuthWorkspaceContext(),
  );
  return Response.json(
    buildKnowledgeBundleDeletionProgressSnapshot(snapshot),
    { headers: { "Cache-Control": "private, no-store, max-age=0" } },
  );
}

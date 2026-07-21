import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import { getKnowledgeBundleDeletionStatusSnapshot } from "@/lib/knowledge-bundle-deletion";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const snapshot = await getKnowledgeBundleDeletionStatusSnapshot(
    await requireAuthWorkspaceContext(),
  );
  return Response.json(
    { active: snapshot.active, fingerprint: snapshot.fingerprint },
    { headers: { "Cache-Control": "private, no-store, max-age=0" } },
  );
}

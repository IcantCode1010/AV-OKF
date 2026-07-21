import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import { getDocumentDeletionStatusSnapshot } from "@/lib/document-deletion";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const context = await requireAuthWorkspaceContext();
  const snapshot = await getDocumentDeletionStatusSnapshot(context);

  return Response.json(
    {
      active: snapshot.active,
      fingerprint: snapshot.fingerprint,
    },
    {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
      },
    },
  );
}

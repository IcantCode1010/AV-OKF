import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import { finalizeDocumentUploadSession } from "@/lib/document-upload-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const [{ sessionId }, context] = await Promise.all([params, requireAuthWorkspaceContext()]);
    const result = await finalizeDocumentUploadSession({ context, sessionId });
    return Response.json({ ...result, href: `/documents/${encodeURIComponent(result.documentId)}?panel=processing` });
  } catch (error) {
    const code = error instanceof Error ? error.message : "upload_finalization_failed";
    const status = code === "authentication_required" ? 401
      : code === "upload_session_not_found" ? 404
        : 400;
    return Response.json({ error: code }, { status });
  }
}

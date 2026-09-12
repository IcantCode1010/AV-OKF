import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import { cancelDocumentUploadSession } from "@/lib/document-upload-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const [{ sessionId }, context] = await Promise.all([
      params,
      requireAuthWorkspaceContext(),
    ]);
    return Response.json(await cancelDocumentUploadSession({ context, sessionId }));
  } catch (error) {
    const code = error instanceof Error ? error.message : "upload_cancellation_failed";
    const status = code === "authentication_required" ? 401
      : code === "upload_session_not_found" ? 404
        : code === "upload_session_already_finalized" ? 409
          : 400;
    return Response.json({ error: code }, { status });
  }
}

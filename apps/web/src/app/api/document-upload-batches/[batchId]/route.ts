import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import { getDocumentUploadBatchStatus } from "@/lib/document-upload-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ batchId: string }> },
) {
  try {
    const [{ batchId }, context] = await Promise.all([
      params,
      requireAuthWorkspaceContext(),
    ]);
    const result = await getDocumentUploadBatchStatus({ batchId, context });
    return Response.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "upload_batch_status_failed";
    const status = code === "authentication_required" ? 401
      : code === "upload_batch_not_found" ? 404
        : 400;
    return Response.json({ error: code }, { status });
  }
}

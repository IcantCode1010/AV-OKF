import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import { createDocumentUploadSession } from "@/lib/document-upload-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const context = await requireAuthWorkspaceContext();
    const body = await request.json() as Record<string, unknown>;
    const metadata = body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
      ? body.metadata as Record<string, unknown>
      : {};
    const result = await createDocumentUploadSession({
      context,
      upload: {
        contentType: stringField(body.contentType),
        filename: stringField(body.filename),
        knowledgeBundleId: stringField(body.knowledgeBundleId),
        metadata: {
          description: stringField(metadata.description),
          owner: stringField(metadata.owner),
          sourceType: metadata.sourceType === "aviation" ? "aviation" : "general",
          tags: Array.isArray(metadata.tags) ? metadata.tags.filter((value): value is string => typeof value === "string") : [],
          title: stringField(metadata.title),
        },
        sizeBytes: numberField(body.sizeBytes),
      },
    });
    return Response.json(result, { status: 201 });
  } catch (error) {
    return uploadErrorResponse(error);
  }
}

function stringField(value: unknown) {
  return typeof value === "string" ? value : "";
}

function numberField(value: unknown) {
  return typeof value === "number" ? value : Number.NaN;
}

function uploadErrorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "upload_session_failed";
  const status = code === "authentication_required" ? 401
    : code === "knowledge_bundle_not_found" || code === "workspace_access_denied" ? 404
      : 400;
  return Response.json({ error: code }, { status });
}

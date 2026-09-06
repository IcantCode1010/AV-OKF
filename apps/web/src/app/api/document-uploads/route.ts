import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import { createDocumentUploadSession } from "@/lib/document-upload-session";
import type { AviationSourceClassification, IntendedAudience } from "@/lib/aviation-document-metadata";

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
          aircraftTypeIds: stringArrayField(metadata.aircraftTypeIds),
          classificationCode: nullableStringField(metadata.classificationCode),
          contentPurpose: nullableStringField(metadata.contentPurpose),
          description: stringField(metadata.description),
          documentType: nullableStringField(metadata.documentType),
          effectivity: nullableStringField(metadata.effectivity),
          intendedAudiences: stringArrayField(metadata.intendedAudiences) as IntendedAudience[],
          licenseIdentifier: nullableStringField(metadata.licenseIdentifier),
          owner: stringField(metadata.owner),
          revision: nullableStringField(metadata.revision),
          sourceAuthority: nullableStringField(metadata.sourceAuthority),
          sourceClassification: nullableStringField(metadata.sourceClassification) as AviationSourceClassification | null,
          sourceType: metadata.sourceType === "aviation" ? "aviation" : "general",
          subjectFamily: nullableStringField(metadata.subjectFamily),
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

function nullableStringField(value: unknown) {
  const result = stringField(value).trim();
  return result || null;
}

function stringArrayField(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function uploadErrorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "upload_session_failed";
  const status = code === "authentication_required" ? 401
    : code === "knowledge_bundle_not_found" || code === "workspace_access_denied" ? 404
      : 400;
  return Response.json({ error: code }, { status });
}

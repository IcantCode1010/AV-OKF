import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import { createDocumentUploadBatch } from "@/lib/document-upload-session";
import type { AviationSourceClassification, IntendedAudience } from "@/lib/aviation-document-metadata";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const context = await requireAuthWorkspaceContext();
    const body = await request.json() as Record<string, unknown>;
    const uploads = Array.isArray(body.uploads) ? body.uploads : [];
    const result = await createDocumentUploadBatch({
      context,
      knowledgeBundleId: stringField(body.knowledgeBundleId),
      uploads: uploads.map((value) => parseUpload(value)),
    });
    return Response.json(result, { status: 201 });
  } catch (error) {
    return uploadBatchErrorResponse(error);
  }
}

function parseUpload(value: unknown) {
  const upload = isRecord(value) ? value : {};
  const metadata = isRecord(upload.metadata) ? upload.metadata : {};
  return {
    contentType: stringField(upload.contentType),
    filename: stringField(upload.filename),
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
      sourceType: metadata.sourceType === "aviation" ? "aviation" as const : "general" as const,
      subjectFamily: nullableStringField(metadata.subjectFamily),
      tags: Array.isArray(metadata.tags)
        ? metadata.tags.filter((item): item is string => typeof item === "string")
        : [],
      title: stringField(metadata.title),
    },
    sizeBytes: typeof upload.sizeBytes === "number" ? upload.sizeBytes : Number.NaN,
  };
}

function stringField(value: unknown) {
  return typeof value === "string" ? value : "";
}

function nullableStringField(value: unknown) {
  const result = stringField(value).trim();
  return result || null;
}

function stringArrayField(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function uploadBatchErrorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "upload_batch_failed";
  const status = code === "authentication_required" ? 401
    : code === "knowledge_bundle_not_found" || code === "workspace_access_denied" ? 404
      : 400;
  return Response.json({ error: code }, { status });
}

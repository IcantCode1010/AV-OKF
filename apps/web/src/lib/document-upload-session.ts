import { randomUUID } from "node:crypto";
import path from "node:path";

import type { Prisma } from "@prisma/client";

import type { AuthWorkspaceContext } from "./auth-workspace.ts";
import { parseTags, type SourceType } from "./document-vault.ts";
import { getPrisma } from "./prisma.ts";
import { getExtractionQueue } from "./production-queue.ts";
import { buildDocumentObjectKey, getObjectStorage } from "./production-storage.ts";
import {
  MAX_DOCUMENTS_PER_UPLOAD_BATCH,
  MAX_LARGE_PDF_PAGES,
  MAX_LARGE_PDF_UPLOAD_BYTES,
  UPLOAD_SESSION_TTL_SECONDS,
} from "./document-upload-limits.ts";
import type { DocumentUploadSessionDescriptor } from "./document-upload-types.ts";

export { MAX_DOCUMENTS_PER_UPLOAD_BATCH, MAX_LARGE_PDF_PAGES, MAX_LARGE_PDF_UPLOAD_BYTES, UPLOAD_SESSION_TTL_SECONDS };

export type DocumentUploadMetadata = {
  description: string;
  owner: string;
  sourceType: SourceType;
  tags: string[];
  title: string;
};

export type CreateDocumentUploadSessionInput = {
  contentType: string;
  filename: string;
  knowledgeBundleId: string;
  metadata: DocumentUploadMetadata;
  sizeBytes: number;
};

export async function createDocumentUploadBatch(input: {
  context: AuthWorkspaceContext;
  knowledgeBundleId: string;
  uploads: Omit<CreateDocumentUploadSessionInput, "knowledgeBundleId">[];
}) {
  if (input.uploads.length < 1 || input.uploads.length > MAX_DOCUMENTS_PER_UPLOAD_BATCH) {
    throw new Error("invalid_upload_batch_size");
  }
  for (const upload of input.uploads) {
    validateDocumentUploadDeclaration({ ...upload, knowledgeBundleId: input.knowledgeBundleId });
  }

  const db = getPrisma();
  const bundle = await db.knowledgeBundle.findFirst({
    select: { id: true },
    where: {
      id: input.knowledgeBundleId,
      status: "active",
      workspaceId: input.context.workspaceId,
    },
  });
  if (!bundle) throw new Error("knowledge_bundle_not_found");

  const expiresAt = new Date(Date.now() + UPLOAD_SESSION_TTL_SECONDS * 1_000);
  const prepared = input.uploads.map((upload) => {
    const documentId = `doc_${randomUUID()}`;
    return {
      ...upload,
      documentId,
      objectKey: buildDocumentObjectKey({
        documentId,
        workspaceId: input.context.workspaceId,
      }),
      originalFilename: normalizePdfFilename(upload.filename),
    };
  });
  const batch = await db.documentUploadBatch.create({
    data: {
      knowledgeBundleId: bundle.id,
      requestedBy: input.context.userId,
      status: "initiated",
      totalFiles: prepared.length,
      workspaceId: input.context.workspaceId,
      sessions: {
        create: prepared.map((upload, batchOrdinal) => ({
          batchOrdinal,
          contentType: "application/pdf",
          documentId: upload.documentId,
          expectedSizeBytes: upload.sizeBytes,
          expiresAt,
          knowledgeBundleId: bundle.id,
          metadata: upload.metadata as unknown as Prisma.InputJsonValue,
          objectKey: upload.objectKey,
          originalFilename: upload.originalFilename,
          requestedBy: input.context.userId,
          workspaceId: input.context.workspaceId,
        })),
      },
    },
    include: { sessions: { orderBy: { batchOrdinal: "asc" } } },
  });

  try {
    const sessions = await Promise.all(batch.sessions.map(async (session) => ({
      documentId: session.documentId,
      expiresAt: session.expiresAt.toISOString(),
      filename: session.originalFilename,
      requiredHeaders: { "Content-Type": session.contentType },
      sessionId: session.id,
      uploadUrl: await getObjectStorage().createPresignedPutUrl({
        contentLength: session.expectedSizeBytes,
        contentType: session.contentType,
        expiresInSeconds: UPLOAD_SESSION_TTL_SECONDS,
        key: session.objectKey,
      }),
    })));
    return { batchId: batch.id, sessions };
  } catch (error) {
    await db.$transaction([
      db.documentUploadSession.updateMany({
        data: { errorCode: "upload_url_creation_failed", status: "failed" },
        where: { batchId: batch.id, status: "initiated" },
      }),
      db.documentUploadBatch.update({
        data: { status: "failed" },
        where: { id: batch.id },
      }),
    ]);
    throw error;
  }
}

export async function createDocumentUploadSession(input: {
  context: AuthWorkspaceContext;
  upload: CreateDocumentUploadSessionInput;
}) {
  validateDocumentUploadDeclaration(input.upload);
  const db = getPrisma();
  const bundle = await db.knowledgeBundle.findFirst({
    select: { id: true },
    where: {
      id: input.upload.knowledgeBundleId,
      status: "active",
      workspaceId: input.context.workspaceId,
    },
  });
  if (!bundle) throw new Error("knowledge_bundle_not_found");

  const documentId = `doc_${randomUUID()}`;
  const objectKey = buildDocumentObjectKey({ documentId, workspaceId: input.context.workspaceId });
  const expiresAt = new Date(Date.now() + UPLOAD_SESSION_TTL_SECONDS * 1_000);
  const session = await db.documentUploadSession.create({
    data: {
      contentType: "application/pdf",
      documentId,
      expectedSizeBytes: input.upload.sizeBytes,
      expiresAt,
      knowledgeBundleId: bundle.id,
      metadata: input.upload.metadata as unknown as Prisma.InputJsonValue,
      objectKey,
      originalFilename: normalizePdfFilename(input.upload.filename),
      requestedBy: input.context.userId,
      workspaceId: input.context.workspaceId,
    },
  });
  const uploadUrl = await getObjectStorage().createPresignedPutUrl({
    contentLength: session.expectedSizeBytes,
    contentType: session.contentType,
    expiresInSeconds: UPLOAD_SESSION_TTL_SECONDS,
    key: session.objectKey,
  });
  return {
    documentId,
    expiresAt: expiresAt.toISOString(),
    requiredHeaders: { "Content-Type": session.contentType },
    sessionId: session.id,
    uploadUrl,
  };
}

export async function finalizeDocumentUploadSession(input: {
  context: AuthWorkspaceContext;
  sessionId: string;
}) {
  const db = getPrisma();
  const session = await db.documentUploadSession.findFirst({
    where: {
      id: input.sessionId,
      requestedBy: input.context.userId,
      workspaceId: input.context.workspaceId,
    },
  });
  if (!session) throw new Error("upload_session_not_found");
  if (session.status === "finalized") return { documentId: session.documentId };
  if (session.status !== "initiated") throw new Error(session.errorCode ?? "upload_session_unavailable");
  if (session.expiresAt.getTime() <= Date.now()) {
    await expireUploadSession(session.id, session.objectKey);
    throw new Error("upload_session_expired");
  }

  const storage = getObjectStorage();
  let object: Awaited<ReturnType<typeof storage.headObject>>;
  try {
    object = await storage.headObject(session.objectKey);
  } catch {
    throw new Error("uploaded_object_not_found");
  }
  if (object.contentLength !== session.expectedSizeBytes) {
    await failAndDeleteUploadSession(session.id, session.objectKey, "uploaded_object_size_mismatch");
    throw new Error("uploaded_object_size_mismatch");
  }
  if (object.contentType !== "application/pdf") {
    await failAndDeleteUploadSession(session.id, session.objectKey, "uploaded_object_content_type_invalid");
    throw new Error("uploaded_object_content_type_invalid");
  }
  const magic = await storage.getObjectRange(session.objectKey, 0, 4);
  if (!magic.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    await failAndDeleteUploadSession(session.id, session.objectKey, "invalid_pdf_magic_bytes");
    throw new Error("invalid_pdf_magic_bytes");
  }

  const metadata = normalizeStoredMetadata(session.metadata);
  const title = metadata.title.trim() || session.originalFilename.replace(/\.pdf$/i, "");
  const result = await db.$transaction(async (tx) => {
    const claim = await tx.documentUploadSession.updateMany({
      data: { finalizedAt: new Date(), status: "finalized" },
      where: { id: session.id, status: "initiated" },
    });
    if (claim.count === 0) return null;
    const document = await tx.document.create({
      data: {
        contentSha256: null,
        description: metadata.description.trim(),
        fileType: "PDF",
        id: session.documentId,
        knowledgeBundleId: session.knowledgeBundleId,
        mimeType: "application/pdf",
        originalFilename: session.originalFilename,
        owner: metadata.owner.trim() || "Unassigned",
        size: formatBytes(session.expectedSizeBytes),
        sizeBytes: session.expectedSizeBytes,
        sourceType: metadata.sourceType,
        status: "processing",
        tags: metadata.tags,
        title,
        updatedLabel: "Just now",
        workspaceId: session.workspaceId,
        objects: { create: {
          bucket: process.env.S3_BUCKET ?? "av-okf",
          contentType: "application/pdf",
          kind: "original_pdf",
          objectKey: session.objectKey,
          sizeBytes: session.expectedSizeBytes,
          workspaceId: session.workspaceId,
        } },
        extractionJobs: { create: { status: "queued", workspaceId: session.workspaceId } },
      },
      include: { extractionJobs: true },
    });
    await tx.activityEvent.create({ data: {
      documentId: document.id,
      documentTitle: title,
      label: "PDF uploaded",
      status: "processing",
      timestamp: "Just now",
      workspaceId: session.workspaceId,
    } });
    return { documentId: document.id, extractionJobId: document.extractionJobs[0]!.id };
  });

  if (!result) return { documentId: session.documentId };
  try {
    await getExtractionQueue().enqueueExtractionJob({
      documentId: result.documentId,
      extractionJobId: result.extractionJobId,
      workspaceId: session.workspaceId,
    });
  } catch (error) {
    console.error("direct_upload_extraction_enqueue_failed", error);
  }
  if (session.batchId) await refreshDocumentUploadBatchStatus(session.batchId);
  return { documentId: result.documentId };
}

export async function cancelDocumentUploadSession(input: {
  context: AuthWorkspaceContext;
  sessionId: string;
}) {
  const db = getPrisma();
  const session = await db.documentUploadSession.findFirst({
    where: {
      id: input.sessionId,
      requestedBy: input.context.userId,
      workspaceId: input.context.workspaceId,
    },
  });
  if (!session) throw new Error("upload_session_not_found");
  if (session.status === "finalized") throw new Error("upload_session_already_finalized");
  if (["cancelled", "expired", "failed"].includes(session.status)) {
    return { batchId: session.batchId, status: session.status };
  }
  try { await getObjectStorage().deleteObject(session.objectKey); } catch { /* already absent */ }
  await db.documentUploadSession.updateMany({
    data: { errorCode: "upload_cancelled", status: "cancelled" },
    where: { id: session.id, status: "initiated" },
  });
  if (session.batchId) await refreshDocumentUploadBatchStatus(session.batchId);
  return { batchId: session.batchId, status: "cancelled" };
}

export async function restartDocumentUploadSession(input: {
  context: AuthWorkspaceContext;
  sessionId: string;
}): Promise<DocumentUploadSessionDescriptor> {
  const db = getPrisma();
  const session = await db.documentUploadSession.findFirst({
    where: {
      id: input.sessionId,
      requestedBy: input.context.userId,
      workspaceId: input.context.workspaceId,
    },
  });
  if (!session) throw new Error("upload_session_not_found");
  if (session.status === "finalized") throw new Error("upload_session_already_finalized");

  try { await getObjectStorage().deleteObject(session.objectKey); } catch { /* already absent */ }
  const expiresAt = new Date(Date.now() + UPLOAD_SESSION_TTL_SECONDS * 1_000);
  const restarted = await db.documentUploadSession.update({
    data: {
      errorCode: null,
      expiresAt,
      finalizedAt: null,
      status: "initiated",
    },
    where: { id: session.id },
  });
  if (session.batchId) {
    await db.documentUploadBatch.updateMany({
      data: { status: "in_progress" },
      where: { id: session.batchId },
    });
  }
  return {
    documentId: restarted.documentId,
    expiresAt: expiresAt.toISOString(),
    filename: restarted.originalFilename,
    requiredHeaders: { "Content-Type": restarted.contentType },
    sessionId: restarted.id,
    uploadUrl: await getObjectStorage().createPresignedPutUrl({
      contentLength: restarted.expectedSizeBytes,
      contentType: restarted.contentType,
      expiresInSeconds: UPLOAD_SESSION_TTL_SECONDS,
      key: restarted.objectKey,
    }),
  };
}

export async function getDocumentUploadBatchStatus(input: {
  batchId: string;
  context: AuthWorkspaceContext;
}) {
  const batch = await getPrisma().documentUploadBatch.findFirst({
    include: {
      sessions: {
        orderBy: { batchOrdinal: "asc" },
        select: {
          documentId: true,
          errorCode: true,
          id: true,
          originalFilename: true,
          status: true,
        },
      },
    },
    where: {
      id: input.batchId,
      requestedBy: input.context.userId,
      workspaceId: input.context.workspaceId,
    },
  });
  if (!batch) throw new Error("upload_batch_not_found");
  return {
    batchId: batch.id,
    status: deriveDocumentUploadBatchStatus(batch.sessions.map((session) => session.status)),
    sessions: batch.sessions,
  };
}

export async function cleanupExpiredDocumentUploadSessions(now = new Date()) {
  const db = getPrisma();
  const sessions = await db.documentUploadSession.findMany({
    select: { id: true, objectKey: true },
    where: { expiresAt: { lte: now }, status: "initiated" },
  });
  for (const session of sessions) await expireUploadSession(session.id, session.objectKey);
  const batchIds = await db.documentUploadSession.findMany({
    distinct: ["batchId"],
    select: { batchId: true },
    where: { id: { in: sessions.map((session) => session.id) }, batchId: { not: null } },
  });
  for (const { batchId } of batchIds) if (batchId) await refreshDocumentUploadBatchStatus(batchId);
  return sessions.length;
}

export function validateDocumentUploadBatchDeclarations(
  uploads: Omit<CreateDocumentUploadSessionInput, "knowledgeBundleId">[],
) {
  if (uploads.length < 1 || uploads.length > MAX_DOCUMENTS_PER_UPLOAD_BATCH) {
    throw new Error("invalid_upload_batch_size");
  }
  for (const upload of uploads) {
    validateDocumentUploadDeclaration({ ...upload, knowledgeBundleId: "batch" });
  }
}

export function deriveDocumentUploadBatchStatus(statuses: string[]) {
  if (statuses.length === 0) return "failed";
  if (statuses.every((status) => status === "finalized")) return "completed";
  if (statuses.some((status) => status === "initiated")) return "in_progress";
  if (statuses.some((status) => status === "finalized")) return "completed_with_failures";
  if (statuses.every((status) => status === "cancelled")) return "cancelled";
  return "failed";
}

export function validateDocumentUploadDeclaration(input: CreateDocumentUploadSessionInput) {
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 0) throw new Error("invalid_upload_size");
  if (input.sizeBytes > MAX_LARGE_PDF_UPLOAD_BYTES) throw new Error("upload_exceeds_250mb_limit");
  if (input.contentType !== "application/pdf") throw new Error("only_pdf_uploads_supported");
  normalizePdfFilename(input.filename);
  if (input.metadata.sourceType !== "aviation" && input.metadata.sourceType !== "general") {
    throw new Error("invalid_source_type");
  }
}

function normalizePdfFilename(filename: string) {
  const normalized = path.basename(filename.replaceAll("\\", "/")).trim();
  if (!normalized || !normalized.toLowerCase().endsWith(".pdf")) throw new Error("only_pdf_uploads_supported");
  return normalized.slice(0, 255);
}

function normalizeStoredMetadata(value: Prisma.JsonValue): DocumentUploadMetadata {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    description: typeof input.description === "string" ? input.description : "",
    owner: typeof input.owner === "string" ? input.owner : "",
    sourceType: input.sourceType === "aviation" ? "aviation" : "general",
    tags: parseTags(Array.isArray(input.tags) ? input.tags.join(",") : ""),
    title: typeof input.title === "string" ? input.title : "",
  };
}

async function expireUploadSession(id: string, objectKey: string) {
  try { await getObjectStorage().deleteObject(objectKey); } catch { /* already absent */ }
  await getPrisma().documentUploadSession.updateMany({
    data: { errorCode: "upload_session_expired", status: "expired" },
    where: { id, status: "initiated" },
  });
}

async function failAndDeleteUploadSession(id: string, objectKey: string, errorCode: string) {
  try { await getObjectStorage().deleteObject(objectKey); } catch { /* already absent */ }
  await getPrisma().documentUploadSession.updateMany({ data: { errorCode, status: "failed" }, where: { id } });
}

async function refreshDocumentUploadBatchStatus(batchId: string) {
  const db = getPrisma();
  const sessions = await db.documentUploadSession.findMany({
    select: { status: true },
    where: { batchId },
  });
  await db.documentUploadBatch.updateMany({
    data: { status: deriveDocumentUploadBatchStatus(sessions.map((session) => session.status)) },
    where: { id: batchId },
  });
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  assertPdfUpload,
  createUploadedDocument,
  generateTopicRecords,
  getDocumentWorkspaceId,
  parseCustomProperties,
  parseTags,
  requestExtraction,
  updateTopicReviewStatus,
  updateDocumentMetadata,
  type DocumentStatus,
  type SourceType,
  type TopicReviewStatus,
} from "@/lib/document-backend";
import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import {
  assertActionDocumentWorkspace,
  normalizeAtaMetadata,
} from "@/lib/document-action-guards";

export async function uploadDocumentAction(formData: FormData) {
  const file = formData.get("file");

  if (!(file instanceof File)) {
    throw new Error("missing_pdf_file");
  }

  assertPdfUpload(file);

  const document = await createUploadedDocument({
    bytes: Buffer.from(await file.arrayBuffer()),
    description: getFormString(formData, "description"),
    originalFilename: file.name,
    owner: getFormString(formData, "owner"),
    sourceType: getSourceType(getFormString(formData, "sourceType")),
    tags: parseTags(getFormString(formData, "tags")),
    title: getFormString(formData, "title"),
    type: file.type,
  });

  await requestExtraction(document.id);

  revalidatePath("/dashboard");
  revalidatePath("/documents");
  redirect(`/documents/${document.id}`);
}

export async function runExtractionAction(formData: FormData) {
  const id = getFormString(formData, "id");

  await requestExtraction(id);

  revalidatePath("/dashboard");
  revalidatePath("/documents");
  revalidatePath(`/documents/${id}`);
  redirect(`/documents/${id}`);
}

export async function generateTopicsAction(formData: FormData) {
  const id = getFormString(formData, "id");

  await generateTopicRecords(id);

  revalidatePath("/dashboard");
  revalidatePath("/documents");
  revalidatePath(`/documents/${id}`);
  redirect(`/documents/${id}`);
}

export async function updateTopicReviewStatusAction(formData: FormData) {
  const documentId = getFormString(formData, "documentId");
  const topicId = getFormString(formData, "topicId");
  const reviewStatus = getTopicReviewStatus(getFormString(formData, "reviewStatus"));

  await updateTopicReviewStatus(topicId, reviewStatus);

  revalidatePath(`/documents/${documentId}`);
  redirect(`/documents/${documentId}`);
}

export async function updateDocumentMetadataAction(formData: FormData) {
  const id = getFormString(formData, "id");
  const context = await requireAuthWorkspaceContext();
  const workspaceId = await getDocumentWorkspaceId(id);

  assertActionDocumentWorkspace({
    context,
    document: { workspaceId },
    mismatchError: "document_workspace_mismatch",
  });

  await updateDocumentMetadata(id, {
    aircraftFamily: getNullableFormString(formData, "aircraftFamily"),
    ata: normalizeAtaMetadata(getNullableFormString(formData, "ata")),
    customProperties: parseCustomProperties(
      getFormString(formData, "customProperties"),
    ),
    description: getFormString(formData, "description"),
    effectivity: getNullableFormString(formData, "effectivity"),
    manualType: getNullableFormString(formData, "manualType"),
    owner: getFormString(formData, "owner"),
    revision: getNullableFormString(formData, "revision"),
    sourceAuthority: getNullableFormString(formData, "sourceAuthority"),
    sourceType: getSourceType(getFormString(formData, "sourceType")),
    status: getDocumentStatus(getFormString(formData, "status")),
    tags: parseTags(getFormString(formData, "tags")),
    title: getFormString(formData, "title"),
  });

  revalidatePath("/dashboard");
  revalidatePath("/documents");
  revalidatePath(`/documents/${id}`);
  redirect(`/documents/${id}`);
}

function getFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function getNullableFormString(formData: FormData, key: string) {
  const value = getFormString(formData, key).trim();
  return value.length > 0 ? value : null;
}

function getSourceType(value: string): SourceType {
  return value === "aviation" ? "aviation" : "general";
}

function getDocumentStatus(value: string): DocumentStatus {
  const statuses: DocumentStatus[] = [
    "ready",
    "processing",
    "needs_review",
    "indexed",
    "blocked",
  ];

  return statuses.includes(value as DocumentStatus)
    ? (value as DocumentStatus)
    : "processing";
}

function getTopicReviewStatus(value: string): TopicReviewStatus {
  const statuses: TopicReviewStatus[] = [
    "needs_review",
    "needs_cleanup",
    "approved",
    "rejected",
  ];

  return statuses.includes(value as TopicReviewStatus)
    ? (value as TopicReviewStatus)
    : "needs_review";
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  assertPdfUpload,
  createUploadedDocument,
  generateTopicRecords,
  getDocumentWorkspaceId,
  getTopicRecordsByDocumentId,
  parseCustomProperties,
  parseTags,
  requestExtraction,
  type ApprovedContentSource,
  updateTopicContent,
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
import { isProductionBackend } from "@/lib/production-document-service";
import {
  approveTopicContentSource,
  enrichTopic,
} from "@/lib/topic-enrichment";
import { softDeleteDocument } from "@/lib/okf-lifecycle";

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

  const topics = await generateTopicRecords(id);

  revalidatePath("/dashboard");
  revalidatePath("/documents");
  revalidatePath(`/documents/${id}`);
  redirect(`/documents/${id}?panel=topics&topicsGenerated=${topics.length}`);
}

export async function updateTopicReviewStatusAction(formData: FormData) {
  const documentId = getFormString(formData, "documentId");
  const topicId = getFormString(formData, "topicId");
  const reviewStatus = getTopicReviewStatus(getFormString(formData, "reviewStatus"));

  if (reviewStatus === "approved") {
    const topic = (await getTopicRecordsByDocumentId(documentId)).find(
      (candidate) => candidate.id === topicId,
    );
    if (topic?.enrichedTitle || topic?.enrichedSummary) {
      throw new Error("topic_approval_requires_content_source");
    }
  }

  await updateTopicReviewStatus(topicId, reviewStatus);

  revalidatePath(`/documents/${documentId}`);
  redirect(`/documents/${documentId}`);
}

export async function enrichTopicAction(formData: FormData) {
  const documentId = getFormString(formData, "documentId");
  const topicId = getFormString(formData, "topicId");
  const context = await requireAuthWorkspaceContext();
  const workspaceId = await getDocumentWorkspaceId(documentId);

  assertActionDocumentWorkspace({
    // Local Stage 1 JSON-vault records may predate workspace metadata.
    allowMissingWorkspace: !isProductionBackend(),
    context,
    document: { workspaceId },
    mismatchError: "topic_enrichment_workspace_mismatch",
  });

  try {
    await enrichTopic(topicId, { context });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "llm_enrichment_requires_api_key"
    ) {
      redirect(
        `/documents/${documentId}?enrichmentError=${encodeURIComponent(
          error.message,
        )}`,
      );
    }

    throw error;
  }

  revalidatePath(`/documents/${documentId}`);
  redirect(`/documents/${documentId}`);
}

export async function approveTopicContentAction(formData: FormData) {
  const documentId = getFormString(formData, "documentId");
  const topicId = getFormString(formData, "topicId");
  const approvedContentSource = getApprovedContentSource(
    getFormString(formData, "approvedContentSource"),
  );
  const context = await requireAuthWorkspaceContext();
  const workspaceId = await getDocumentWorkspaceId(documentId);

  assertActionDocumentWorkspace({
    // Local Stage 1 JSON-vault records may predate workspace metadata.
    allowMissingWorkspace: !isProductionBackend(),
    context,
    document: { workspaceId },
    mismatchError: "topic_enrichment_workspace_mismatch",
  });

  await approveTopicContentSource(topicId, approvedContentSource, { context });

  revalidatePath(`/documents/${documentId}`);
  redirect(`/documents/${documentId}`);
}

export async function updateTopicContentAction(formData: FormData) {
  const documentId = getFormString(formData, "documentId");
  const topicId = getFormString(formData, "topicId");
  const context = await requireAuthWorkspaceContext();
  const workspaceId = await getDocumentWorkspaceId(documentId);

  assertActionDocumentWorkspace({
    // Local Stage 1 JSON-vault records may predate workspace metadata.
    allowMissingWorkspace: !isProductionBackend(),
    context,
    document: { workspaceId },
    mismatchError: "document_workspace_mismatch",
  });

  const topic = (await getTopicRecordsByDocumentId(documentId)).find(
    (candidate) => candidate.id === topicId,
  );

  if (!topic) {
    throw new Error("topic_not_found");
  }

  if (topic.reviewStatus === "approved") {
    throw new Error("topic_content_edit_requires_unapproved_topic");
  }

  await updateTopicContent(topicId, {
    editedBy: context.userId,
    summary: getFormString(formData, "summary"),
    title: getFormString(formData, "title"),
  });

  revalidatePath(`/documents/${documentId}`);
  redirect(`/documents/${documentId}`);
}

export async function updateDocumentMetadataAction(formData: FormData) {
  const id = getFormString(formData, "id");
  const context = await requireAuthWorkspaceContext();
  const workspaceId = await getDocumentWorkspaceId(id);

  assertActionDocumentWorkspace({
    // Local Stage 1 JSON-vault records may predate workspace metadata.
    allowMissingWorkspace: !isProductionBackend(),
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

export async function softDeleteDocumentAction(formData: FormData) {
  const id = getFormString(formData, "id");
  const reason = getFormString(formData, "reason");
  const context = await requireAuthWorkspaceContext();
  const workspaceId = await getDocumentWorkspaceId(id);

  assertActionDocumentWorkspace({
    // Local Stage 1 JSON-vault records may predate workspace metadata.
    allowMissingWorkspace: !isProductionBackend(),
    context,
    document: { workspaceId },
    mismatchError: "document_workspace_mismatch",
  });

  if (!isProductionBackend()) {
    redirect(
      `/documents/${id}?deleteError=${encodeURIComponent(
        "lifecycle_requires_production_backend",
      )}`,
    );
  }

  try {
    await softDeleteDocument({
      actorId: context.userId,
      documentId: id,
      reason,
      workspaceId: context.workspaceId,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "document_delete_reason_required"
    ) {
      redirect(
        `/documents/${id}?deleteError=${encodeURIComponent(error.message)}`,
      );
    }

    throw error;
  }

  revalidatePath("/dashboard");
  revalidatePath("/documents");
  revalidatePath("/knowledge");
  revalidatePath("/knowledge/bundle");
  redirect("/documents");
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

function getApprovedContentSource(value: string): ApprovedContentSource {
  if (value !== "raw" && value !== "enriched") {
    throw new Error("approved_content_source_required");
  }

  return value;
}

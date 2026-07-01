"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  assertPdfUpload,
  createUploadedDocument,
  parseCustomProperties,
  parseTags,
  updateDocumentMetadata,
  type DocumentStatus,
  type SourceType,
} from "@/lib/document-vault";

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

  revalidatePath("/dashboard");
  revalidatePath("/documents");
  redirect(`/documents/${document.id}`);
}

export async function updateDocumentMetadataAction(formData: FormData) {
  const id = getFormString(formData, "id");

  await updateDocumentMetadata(id, {
    customProperties: parseCustomProperties(
      getFormString(formData, "customProperties"),
    ),
    description: getFormString(formData, "description"),
    owner: getFormString(formData, "owner"),
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

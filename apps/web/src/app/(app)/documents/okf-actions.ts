"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  getDocumentById,
  getTopicRecordsByDocumentId,
} from "@/lib/document-backend";

export async function exportTopicToOkfAction(formData: FormData) {
  const documentId = getFormString(formData, "documentId");
  const topicId = getFormString(formData, "topicId");
  const [document, topics] = await Promise.all([
    getDocumentById(documentId),
    getTopicRecordsByDocumentId(documentId),
  ]);

  if (!document) {
    throw new Error("document_not_found");
  }

  const { exportApprovedTopicForDocument } = await import(
    "@/lib/okf-export-service"
  );
  await exportApprovedTopicForDocument({
    document,
    topicId,
    topics,
  });

  revalidatePath(`/documents/${documentId}`);
  redirect(`/documents/${documentId}`);
}

function getFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  getDocumentById,
  getDocumentWorkspaceId,
  getTopicRecordsByDocumentId,
} from "@/lib/document-backend";
import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import { assertActionDocumentWorkspace } from "@/lib/document-action-guards";

export async function exportTopicToOkfAction(formData: FormData) {
  const documentId = getFormString(formData, "documentId");
  const topicId = getFormString(formData, "topicId");
  const context = await requireAuthWorkspaceContext();
  const workspaceId = await getDocumentWorkspaceId(documentId);

  assertActionDocumentWorkspace({
    context,
    document: { workspaceId },
    mismatchError: "okf_export_workspace_mismatch",
  });

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

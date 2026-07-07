"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  getDocumentById,
  getDocumentWorkspaceId,
  getTopicRecordsByDocumentId,
  updateTopicExportedFilePath,
  updateTopicRelations,
} from "@/lib/document-backend";
import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import { assertActionDocumentWorkspace } from "@/lib/document-action-guards";
import { isProductionBackend } from "@/lib/production-document-service";
import { getDefaultKnowledgeRoot } from "@/lib/knowledge-root";
import { isRecoverableOkfExportError } from "@/lib/okf-export-errors";
import { markOkfConceptLifecycle } from "@/lib/okf-lifecycle";
import type { TopicRelation } from "@/lib/okf-relation-types";

export async function exportTopicToOkfAction(formData: FormData) {
  const documentId = getFormString(formData, "documentId");
  const topicId = getFormString(formData, "topicId");
  const context = await requireAuthWorkspaceContext();
  const workspaceId = await getDocumentWorkspaceId(documentId);

  assertActionDocumentWorkspace({
    // Local Stage 1 JSON-vault records may predate workspace metadata.
    allowMissingWorkspace: !isProductionBackend(),
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
  try {
    const exported = await exportApprovedTopicForDocument({
      document,
      topicId,
      topics,
    });
    await updateTopicExportedFilePath(topicId, exported.filename);
  } catch (error) {
    if (isRecoverableOkfExportError(error)) {
      redirect(
        `/documents/${documentId}?okfExportError=${encodeURIComponent(
          error.message,
        )}`,
      );
    }

    throw error;
  }

  revalidatePath(`/documents/${documentId}`);
  redirect(`/documents/${documentId}`);
}

export async function updateTopicRelationsAction(formData: FormData) {
  const documentId = getFormString(formData, "documentId");
  const topicId = getFormString(formData, "topicId");
  const relationAction = getFormString(formData, "relationAction");
  const context = await requireAuthWorkspaceContext();
  const workspaceId = await getDocumentWorkspaceId(documentId);

  assertActionDocumentWorkspace({
    // Local Stage 1 JSON-vault records may predate workspace metadata.
    allowMissingWorkspace: !isProductionBackend(),
    context,
    document: { workspaceId },
    mismatchError: "okf_export_workspace_mismatch",
  });

  const topic = (await getTopicRecordsByDocumentId(documentId)).find(
    (candidate) => candidate.id === topicId,
  );

  if (!topic) {
    throw new Error("topic_not_found");
  }

  if (topic.reviewStatus !== "approved") {
    throw new Error("topic_relations_require_approved_topic");
  }

  const relations = buildNextRelations(topic.relations, relationAction, formData);
  const { RelationValidationError, validateTopicRelations } = await import(
    "@/lib/okf-relations"
  );

  try {
    await validateTopicRelations(relations, getDefaultKnowledgeRoot());
  } catch (error) {
    if (error instanceof RelationValidationError) {
      redirect(
        `/documents/${documentId}?relationError=${encodeURIComponent(
          JSON.stringify(error.violation),
        )}`,
      );
    }

    throw error;
  }

  await updateTopicRelations(topicId, relations);

  revalidatePath(`/documents/${documentId}`);
  redirect(`/documents/${documentId}`);
}

export async function markOkfConceptLifecycleAction(formData: FormData) {
  const documentId = getFormString(formData, "documentId");
  const topicId = getFormString(formData, "topicId");
  const status = getLifecycleStatus(getFormString(formData, "lifecycleStatus"));
  const reason = getFormString(formData, "reason");
  const context = await requireAuthWorkspaceContext();
  const workspaceId = await getDocumentWorkspaceId(documentId);

  assertActionDocumentWorkspace({
    // Local Stage 1 JSON-vault records may predate workspace metadata.
    allowMissingWorkspace: !isProductionBackend(),
    context,
    document: { workspaceId },
    mismatchError: "okf_lifecycle_workspace_mismatch",
  });

  if (!isProductionBackend()) {
    redirect(
      `/documents/${documentId}?panel=topics&topic=${topicId}&lifecycleError=${encodeURIComponent(
        "lifecycle_requires_production_backend",
      )}`,
    );
  }

  const topics = await getTopicRecordsByDocumentId(documentId);
  const topic = topics.find((candidate) => candidate.id === topicId);

  if (!topic || topic.documentId !== documentId) {
    throw new Error("topic_not_found");
  }

  if (topic.reviewStatus !== "approved") {
    throw new Error("okf_lifecycle_requires_approved_topic");
  }

  if (!topic.exportedFilePath) {
    throw new Error("okf_lifecycle_requires_exported_topic");
  }

  try {
    await markOkfConceptLifecycle({
      actorId: context.userId,
      filePath: topic.exportedFilePath,
      knowledgeRoot: getDefaultKnowledgeRoot(),
      reason,
      status,
      topicId,
      workspaceId: context.workspaceId,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "okf_lifecycle_reason_required"
    ) {
      redirect(
        `/documents/${documentId}?panel=topics&topic=${topicId}&lifecycleError=${encodeURIComponent(
          error.message,
        )}`,
      );
    }

    throw error;
  }

  revalidatePath(`/documents/${documentId}`);
  revalidatePath("/knowledge");
  revalidatePath("/knowledge/bundle");
  redirect(
    `/documents/${documentId}?panel=topics&topic=${topicId}&lifecycleUpdated=${status}`,
  );
}

function getFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function buildNextRelations(
  currentRelations: TopicRelation[],
  relationAction: string,
  formData: FormData,
) {
  if (relationAction === "remove") {
    const index = Number.parseInt(getFormString(formData, "relationIndex"), 10);
    if (!Number.isInteger(index) || index < 0) {
      throw new Error("relation_index_invalid");
    }

    return currentRelations.filter((_, relationIndex) => relationIndex !== index);
  }

  if (relationAction !== "add") {
    throw new Error("relation_action_invalid");
  }

  return [
    ...currentRelations,
    buildRelationFromForm(formData),
  ];
}

function buildRelationFromForm(formData: FormData): TopicRelation {
  const rawTarget = getFormString(formData, "target");
  const [target, targetTypeFromTarget] = rawTarget.split("::");

  return {
    relation: getFormString(formData, "relation"),
    target: target ?? "",
    targetType: getFormString(formData, "targetType") || targetTypeFromTarget || null,
    reason: getFormString(formData, "reason"),
  };
}

function getLifecycleStatus(value: string): "archived" | "retracted" {
  if (value === "archived" || value === "retracted") {
    return value;
  }

  throw new Error("okf_lifecycle_status_invalid");
}

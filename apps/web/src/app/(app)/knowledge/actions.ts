"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import { markOkfConceptLifecycle } from "@/lib/okf-lifecycle";
import { isProductionBackend } from "@/lib/production-document-service";
import {
  createKnowledgeBundle,
  activateKnowledgeProfileVersion,
  createKnowledgeProfileDraft,
  getKnowledgeBundle,
  getDefaultKnowledgeBundle,
  resolveKnowledgeBundleRoot,
} from "@/lib/knowledge-bundles";
import type {
  KnowledgeFieldType,
  KnowledgeFolderCategory,
} from "@/lib/knowledge-profile";
import { requestKnowledgeBundleDeletion } from "@/lib/knowledge-bundle-deletion";
import { discoverOkfRelationCandidates } from "@/lib/okf-relation-discovery";
import {
  getDocumentById,
  getTopicRecordsByDocumentId,
  updateTopicExportedFilePath,
  updateTopicRelations,
} from "@/lib/document-backend";
import { getPrisma } from "@/lib/prisma";
import { readOkfBundleFile } from "@/lib/okf-bundle";
import { getFrontmatterScalar, parseOkfMarkdown } from "@/lib/okf-frontmatter";
import { validateTopicRelations } from "@/lib/okf-relations";
import { normalizeTopicRelations } from "@/lib/okf-relation-types";

export async function createKnowledgeBundleAction(formData: FormData) {
  const context = await requireAuthWorkspaceContext();
  const template = getFormString(formData, "template");
  const bundle = await createKnowledgeBundle({
    context,
    description: getFormString(formData, "description"),
    name: getFormString(formData, "name"),
    templateId: template === "aviation" ? "aviation" : "generic",
  });
  revalidatePath("/knowledge");
  redirect(`/knowledge/${bundle.id}`);
}

export async function createKnowledgeProfileDraftAction(formData: FormData) {
  const context = await requireAuthWorkspaceContext();
  const bundleId = getFormString(formData, "knowledgeBundleId");
  const bundle = await getKnowledgeBundle({ bundleId, context });
  if (!bundle) throw new Error("knowledge_bundle_not_found");
  const profile = structuredClone(bundle.profile);
  profile.id = `custom-${bundle.id}`;
  profile.name = getFormString(formData, "profileName").trim() || `${bundle.name} profile`;
  profile.clarificationFields = getFormString(formData, "clarificationFields")
    .split(",")
    .map((value) => normalizeProfileIdentifier(value))
    .filter(Boolean);

  const typeId = normalizeProfileIdentifier(getFormString(formData, "typeId"));
  if (typeId) {
    profile.types[typeId] = {
      category: normalizeFolderCategory(getFormString(formData, "typeCategory")),
      label: getFormString(formData, "typeLabel").trim() || typeId,
    };
  }
  const fieldId = normalizeProfileIdentifier(getFormString(formData, "fieldId"));
  if (fieldId && !["type", "title", "description", "tags", "updated"].includes(fieldId)) {
    profile.fields[fieldId] = {
      required: getFormString(formData, "fieldRequired") === "true",
      type: normalizeFieldType(getFormString(formData, "fieldType")),
    };
  }
  const relations = getFormString(formData, "relations").split(",").map((value) => normalizeProfileIdentifier(value)).filter(Boolean);
  if (relations.length > 0) profile.relations = [...new Set(relations)];

  const version = await createKnowledgeProfileDraft({ bundleId, context, profile });
  revalidatePath(`/knowledge/${bundleId}`);
  redirect(`/knowledge/${bundleId}?profileDraft=${version}`);
}

export async function activateKnowledgeProfileAction(formData: FormData) {
  const context = await requireAuthWorkspaceContext();
  const bundleId = getFormString(formData, "knowledgeBundleId");
  const version = Number.parseInt(getFormString(formData, "version"), 10);
  if (!Number.isInteger(version)) throw new Error("knowledge_profile_version_invalid");
  await activateKnowledgeProfileVersion({ bundleId, context, version });
  revalidatePath(`/knowledge/${bundleId}`);
  redirect(`/knowledge/${bundleId}?profileActivated=${version}`);
}

export async function deleteKnowledgeBundleAction(formData: FormData) {
  const context = await requireAuthWorkspaceContext();
  const bundleId = getFormString(formData, "knowledgeBundleId");
  await requestKnowledgeBundleDeletion({
    actorId: context.userId,
    bundleId,
    confirmedName: getFormString(formData, "confirmedName"),
    workspaceId: context.workspaceId,
  });
  revalidatePath("/knowledge");
  redirect("/knowledge?deletionQueued=1");
}

export async function discoverRelationsAction(formData: FormData) {
  const context = await requireAuthWorkspaceContext();
  const bundleId = getFormString(formData, "knowledgeBundleId");
  const result = await discoverOkfRelationCandidates({ knowledgeBundleId: bundleId, workspaceId: context.workspaceId });
  revalidatePath(`/knowledge/${bundleId}`);
  redirect(`/knowledge/${bundleId}?relationsDiscovered=${result.discovered}`);
}

export async function reviewRelationCandidateAction(formData: FormData) {
  const context = await requireAuthWorkspaceContext();
  const candidateId = getFormString(formData, "candidateId");
  const decision = getFormString(formData, "decision");
  const candidate = await getPrisma().okfRelationCandidate.findFirst({
    where: { id: candidateId, status: "pending", workspaceId: context.workspaceId },
  });
  if (!candidate) throw new Error("relation_candidate_not_found");
  if (decision === "reject") {
    await getPrisma().okfRelationCandidate.update({ data: { reviewedAt: new Date(), reviewedBy: context.userId, status: "rejected" }, where: { id: candidate.id } });
    revalidatePath(`/knowledge/${candidate.knowledgeBundleId}`);
    redirect(`/knowledge/${candidate.knowledgeBundleId}`);
  }
  const bundle = await getKnowledgeBundle({ bundleId: candidate.knowledgeBundleId, context });
  if (!bundle) throw new Error("knowledge_bundle_not_found");
  if (!bundle.profile.relations.includes(candidate.relation)) throw new Error("relation_type_not_allowed");
  const root = resolveKnowledgeBundleRoot({ bundleId: bundle.id, workspaceId: context.workspaceId });
  const sourceTopic = await getPrisma().topicRecord.findFirst({ where: { exportedFilePath: candidate.sourceFile, knowledgeBundleId: bundle.id } });
  if (!sourceTopic) throw new Error("relation_source_topic_not_found");
  const target = await readOkfBundleFile(root, candidate.targetFile);
  const targetType = getFrontmatterScalar(parseOkfMarkdown(target.content).frontmatter, "type");
  if (!targetType) throw new Error("relation_target_type_mismatch");
  const relations = [...normalizeTopicRelations(sourceTopic.relations), {
    reason: candidate.reason,
    relation: candidate.relation,
    target: candidate.targetFile,
    targetType,
  }];
  await validateTopicRelations(relations, root);
  await updateTopicRelations(sourceTopic.id, relations);
  const document = await getDocumentById(sourceTopic.documentId);
  if (!document) throw new Error("document_not_found");
  const topics = await getTopicRecordsByDocumentId(document.id);
  const { exportApprovedTopicForDocument } = await import("@/lib/okf-export-service");
  const exported = await exportApprovedTopicForDocument({ document, topicId: sourceTopic.id, topics });
  await updateTopicExportedFilePath(sourceTopic.id, exported.filename);
  await getPrisma().okfRelationCandidate.update({ data: { reviewedAt: new Date(), reviewedBy: context.userId, status: "approved" }, where: { id: candidate.id } });
  revalidatePath(`/knowledge/${bundle.id}`);
  redirect(`/knowledge/${bundle.id}?file=${encodeURIComponent(exported.filename)}`);
}

export async function deleteOkfBundleFilesAction(formData: FormData) {
  const filenames = formData
    .getAll("filenames")
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  const reason = getFormString(formData, "reason");
  const context = await requireAuthWorkspaceContext();
  const requestedBundleId = getFormString(formData, "knowledgeBundleId");
  const bundle = requestedBundleId
    ? await getKnowledgeBundle({ bundleId: requestedBundleId, context })
    : await getDefaultKnowledgeBundle(context);
  if (!bundle) throw new Error("knowledge_bundle_not_found");
  const knowledgeRoot = resolveKnowledgeBundleRoot({
    bundleId: bundle.id,
    workspaceId: context.workspaceId,
  });

  if (!isProductionBackend()) {
    redirect(
      `/knowledge/${bundle.id}?deleteError=${encodeURIComponent(
        "lifecycle_requires_production_backend",
      )}`,
    );
  }

  if (filenames.length === 0) {
    redirect(
      `/knowledge/${bundle.id}?deleteError=${encodeURIComponent(
        "okf_bundle_delete_requires_selection",
      )}`,
    );
  }

  try {
    for (const filePath of filenames) {
      await markOkfConceptLifecycle({
        actorId: context.userId,
        filePath,
        knowledgeBundleId: bundle.id,
        knowledgeRoot,
        reason,
        status: "deleted",
        workspaceId: context.workspaceId,
      });
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "okf_lifecycle_reason_required"
    ) {
      redirect(
        `/knowledge/${bundle.id}?deleteError=${encodeURIComponent(error.message)}`,
      );
    }

    throw error;
  }

  revalidatePath("/knowledge");
  revalidatePath("/knowledge/bundle");
  revalidatePath(`/knowledge/${bundle.id}`);
  redirect(`/knowledge/${bundle.id}?deleted=${filenames.length}`);
}

function getFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function normalizeProfileIdentifier(value: string) {
  const normalized = value.trim().toLowerCase().replaceAll("-", "_");
  return /^[a-z][a-z0-9_]{0,63}$/.test(normalized) ? normalized : "";
}

function normalizeFolderCategory(value: string): KnowledgeFolderCategory {
  return ["concepts", "indexes", "procedures", "references", "routing"].includes(value)
    ? value as KnowledgeFolderCategory
    : "concepts";
}

function normalizeFieldType(value: string): KnowledgeFieldType {
  return ["date", "number", "number_array", "relations", "string", "string_array"].includes(value)
    ? value as KnowledgeFieldType
    : "string";
}

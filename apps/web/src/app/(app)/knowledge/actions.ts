"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";

import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import { ACTIVE_KNOWLEDGE_BUNDLE_COOKIE } from "@/lib/active-knowledge-bundle";
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
import { normalizeRelationDiscoveryStopwords } from "@/lib/knowledge-profile";
import {
  requestKnowledgeBundleDeletion,
  retryKnowledgeBundleDeletion,
} from "@/lib/knowledge-bundle-deletion";
import { discoverOkfRelationCandidates } from "@/lib/okf-relation-discovery";
import { retryOkfRelationVerification } from "@/lib/okf-relation-verification";
import { getPrisma } from "@/lib/prisma";
import { approveVerifiedRelationCandidate } from "@/lib/okf-relation-approval";

export async function createKnowledgeBundleAction(formData: FormData) {
  const context = await requireAuthWorkspaceContext();
  const template = getFormString(formData, "template");
  const bundle = await createKnowledgeBundle({
    context,
    description: getFormString(formData, "description"),
    name: getFormString(formData, "name"),
    templateId: template === "aviation" ? "aviation" : "generic",
  });
  (await cookies()).set(ACTIVE_KNOWLEDGE_BUNDLE_COOKIE, bundle.id, {
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  revalidatePath("/knowledge");
  redirect(`/documents?scope=bundle&knowledgeBundleId=${encodeURIComponent(bundle.id)}`);
}

export async function createKnowledgeProfileDraftAction(formData: FormData) {
  const context = await requireAuthWorkspaceContext();
  if (context.role !== "admin") throw new Error("knowledge_profile_admin_required");
  const bundleId = getFormString(formData, "knowledgeBundleId");
  const bundle = await getKnowledgeBundle({ bundleId, context });
  if (!bundle) throw new Error("knowledge_bundle_not_found");
  const profile = structuredClone(bundle.profile);
  profile.id = `custom-${bundle.id}`;
  profile.name = getFormString(formData, "profileName").trim() || `${bundle.name} profile`;
  profile.agent.boundedAdaptiveRetryEnabled =
    getFormString(formData, "boundedAdaptiveRetryEnabled") === "true";
  profile.automation.autoApproveEnrichedTopics =
    getFormString(formData, "autoApproveEnrichedTopics") === "true";
  profile.automation.autoApproveVerifiedRelations =
    getFormString(formData, "autoApproveVerifiedRelations") === "true";
  profile.clarificationFields = getFormString(formData, "clarificationFields")
    .split(",")
    .map((value) => normalizeProfileIdentifier(value))
    .filter(Boolean);
  profile.relationDiscovery.stopwords = normalizeRelationDiscoveryStopwords(
    getFormString(formData, "relationDiscoveryStopwords")
      .split(",")
      .map((value) => value.trim()),
  );

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
  revalidatePath(`/knowledge/${bundleId}/settings`);
  redirect(`/knowledge/${bundleId}/settings?profileDraft=${version}`);
}

export async function activateKnowledgeProfileAction(formData: FormData) {
  const context = await requireAuthWorkspaceContext();
  if (context.role !== "admin") throw new Error("knowledge_profile_admin_required");
  const bundleId = getFormString(formData, "knowledgeBundleId");
  const version = Number.parseInt(getFormString(formData, "version"), 10);
  if (!Number.isInteger(version)) throw new Error("knowledge_profile_version_invalid");
  await activateKnowledgeProfileVersion({ bundleId, context, version });
  revalidatePath(`/knowledge/${bundleId}/settings`);
  redirect(`/knowledge/${bundleId}/settings?profileActivated=${version}`);
}

export async function deleteKnowledgeBundleAction(formData: FormData) {
  const context = await requireAuthWorkspaceContext();
  const bundleId = getFormString(formData, "knowledgeBundleId");
  await requestKnowledgeBundleDeletion({
    actorId: context.userId,
    bundleId,
    workspaceId: context.workspaceId,
  });
  revalidatePath("/knowledge");
  redirect("/knowledge?deletionQueued=1");
}

export async function retryKnowledgeBundleDeletionAction(formData: FormData) {
  const context = await requireAuthWorkspaceContext();
  await retryKnowledgeBundleDeletion({
    context,
    jobId: getFormString(formData, "jobId"),
  });
  revalidatePath("/knowledge");
  redirect("/knowledge");
}

export async function discoverRelationsAction(formData: FormData) {
  const context = await requireAuthWorkspaceContext();
  const bundleId = getFormString(formData, "knowledgeBundleId");
  const result = await discoverOkfRelationCandidates({
    knowledgeBundleId: bundleId,
    requestedBy: context.userId,
    workspaceId: context.workspaceId,
  });
  revalidatePath(`/knowledge/${bundleId}/relations`);
  redirect(`/knowledge/${bundleId}/relations?relationsDiscovered=${result.discovered}&semanticCandidates=${result.semanticCandidates}&relationsSuppressed=${result.suppressed}&relationWarnings=${result.warnings}`);
}

export async function reviewRelationCandidateAction(formData: FormData) {
  const context = await requireAuthWorkspaceContext();
  const candidateId = getFormString(formData, "candidateId");
  const decision = getFormString(formData, "decision");
  const candidate = await getPrisma().okfRelationCandidate.findFirst({
    where: { id: candidateId, status: "pending", verificationStatus: "confirmed", workspaceId: context.workspaceId },
  });
  if (!candidate) throw new Error("relation_candidate_not_found");
  if (decision === "reject") {
    await getPrisma().okfRelationCandidate.update({ data: { reviewedAt: new Date(), reviewedBy: context.userId, status: "rejected" }, where: { id: candidate.id } });
    revalidatePath(`/knowledge/${candidate.knowledgeBundleId}/relations`);
    return;
  }
  let result: Awaited<ReturnType<typeof approveVerifiedRelationCandidate>>;
  try {
    result = await approveVerifiedRelationCandidate({
      actorId: context.userId,
      candidateId: candidate.id,
      mode: "human",
      workspaceId: context.workspaceId,
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "relation_approval_failed";
    redirect(`/knowledge/${candidate.knowledgeBundleId}/relations?relationError=${encodeURIComponent(code)}`);
  }
  revalidatePath(`/knowledge/${result.bundleId}/relations`);
  if (result.status === "reverification_queued") {
    redirect(`/knowledge/${result.bundleId}/relations?relationError=relation_verification_stale_content`);
  }
}

export async function retryRelationCandidateVerificationAction(formData: FormData) {
  const context = await requireAuthWorkspaceContext();
  const candidateId = getFormString(formData, "candidateId");
  const direction = getFormString(formData, "direction");
  const candidate = await getPrisma().okfRelationCandidate.findFirst({
    where: { id: candidateId, status: "pending", workspaceId: context.workspaceId },
  });
  if (!candidate) throw new Error("relation_candidate_not_found");
  await retryOkfRelationVerification({
    candidateId,
    requestedDirection: direction === "reverse" || direction === "proposed" ? direction : null,
    workspaceId: context.workspaceId,
  });
  revalidatePath(`/knowledge/${candidate.knowledgeBundleId}/relations`);
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
      `/knowledge/${bundle.id}/settings?deleteError=${encodeURIComponent(
        "lifecycle_requires_production_backend",
      )}`,
    );
  }

  if (filenames.length === 0) {
    redirect(
      `/knowledge/${bundle.id}/settings?deleteError=${encodeURIComponent(
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
        `/knowledge/${bundle.id}/settings?deleteError=${encodeURIComponent(error.message)}`,
      );
    }

    throw error;
  }

  revalidatePath("/knowledge");
  revalidatePath("/knowledge/bundle");
  revalidatePath(`/knowledge/${bundle.id}/settings`);
  revalidatePath(`/knowledge/${bundle.id}/browse`);
  redirect(`/knowledge/${bundle.id}/settings?deleted=${filenames.length}`);
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
  return ["date", "number", "number_array", "object", "object_array", "relations", "string", "string_array"].includes(value)
    ? value as KnowledgeFieldType
    : "string";
}

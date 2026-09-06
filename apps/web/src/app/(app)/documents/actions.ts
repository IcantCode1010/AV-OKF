"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  assertPdfUpload,
  createUploadedDocument,
  generateTopicRecords,
  getDocumentById,
  getDocumentWorkspaceId,
  getTopicRecordsByDocumentId,
  parseCustomProperties,
  parseTags,
  requestExtraction,
  type ApprovedContentSource,
  updateTopicContent,
  updateTopicOkfMetadata,
  updateTopicReviewStatus,
  updateDocumentMetadata,
  type DocumentStatus,
  type SourceType,
  type TopicReviewStatus,
} from "@/lib/document-backend";
import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import {
  assertActionDocumentWorkspace,
  normalizeClassificationCode,
} from "@/lib/document-action-guards";
import { isProductionBackend } from "@/lib/production-document-service";
import {
  approveTopicContentSource,
  enrichTopic,
  resolveTopicEnrichmentCandidateDecision,
} from "@/lib/topic-enrichment";
import {
  requestPermanentDocumentDeletion,
  retryPermanentDocumentDeletion,
} from "@/lib/document-deletion";
import { getKnowledgeBundle, getKnowledgeBundleByIdentity } from "@/lib/knowledge-bundles";
import { getPrisma } from "@/lib/prisma";
import { requestTopicDiscovery, resolveProposedTopicPages } from "@/lib/topic-discovery-actions";
import {
  confirmKnowledgeAuthoringCost,
  createKnowledgeAuthoringRun,
  promoteAuthoringRelationSuggestions,
  undoAuthoringMetadata,
} from "@/lib/knowledge-authoring";
import { createBullMqKnowledgeAuthoringQueue } from "@/lib/knowledge-authoring-queue";
import { getDocumentProcessingHref } from "@/lib/document-row-navigation";
import { getEntityGraphQueue } from "@/lib/entity-graph-queue";
import {
  emptyAviationDocumentMetadata,
  normalizeAviationDocumentMetadata,
} from "@/lib/aviation-document-metadata";
import { createAutomaticPocEfbReleaseJob } from "@/lib/efb-release-automation";
import { createEfbReleaseQueue } from "@/lib/efb-release-queue";
import { normalizeManualAircraftApplicability } from "@/lib/aircraft-applicability";

const RECOVERABLE_UPLOAD_ERRORS = new Set([
  "missing_pdf_file",
  "only_pdf_uploads_supported",
  "upload_exceeds_250mb_limit",
  "invalid_pdf_magic_bytes",
  "invalid_aviation_ata",
  "invalid_aviation_aircraft_type_id",
  "invalid_aviation_source_classification",
  "invalid_aviation_intended_audience",
  "aviation_intended_audience_required",
  "aviation_content_purpose_required",
]);

export async function uploadDocumentAction(formData: FormData) {
  if (isProductionBackend()) {
    throw new Error("production_upload_requires_direct_storage_session");
  }
  const file = formData.get("file");
  const context = await requireAuthWorkspaceContext();
  const knowledgeBundleId = getFormString(formData, "knowledgeBundleId");
  let document: Awaited<ReturnType<typeof createUploadedDocument>>;

  try {
    if (!(file instanceof File)) {
      throw new Error("missing_pdf_file");
    }

    assertPdfUpload(file);

    const bundle = await getKnowledgeBundle({ bundleId: knowledgeBundleId, context });
    if (!bundle) {
      throw new Error("knowledge_bundle_not_found");
    }

    const sourceType = getSourceType(getFormString(formData, "sourceType"));
    const aviation = getAviationMetadata(formData, sourceType);
    document = await createUploadedDocument({
      ...aviation,
      bytes: Buffer.from(await file.arrayBuffer()),
      description: getFormString(formData, "description"),
      knowledgeBundleId: bundle.id,
      originalFilename: file.name,
      owner: getFormString(formData, "owner"),
      sourceType,
      tags: parseTags(getFormString(formData, "tags")),
      title: getFormString(formData, "title"),
      type: file.type,
    });
  } catch (error) {
    if (error instanceof Error && RECOVERABLE_UPLOAD_ERRORS.has(error.message)) {
      redirect(`/documents?uploadError=${encodeURIComponent(error.message)}`);
    }

    throw error;
  }

  await requestExtraction(document.id);

  revalidatePath("/dashboard");
  revalidatePath("/documents");
  redirect(getDocumentProcessingHref(document.id));
}

export async function runExtractionAction(formData: FormData) {
  const id = getFormString(formData, "id");

  await requestExtraction(id);

  revalidatePath("/dashboard");
  revalidatePath("/documents");
  revalidatePath(`/documents/${id}`);
  redirect(getDocumentProcessingHref(id));
}

export async function assignDocumentToKnowledgeBundleAction(formData: FormData) {
  const context = await requireAuthWorkspaceContext();
  if (!isProductionBackend()) throw new Error("document_assignment_requires_production_backend");
  const documentId = getFormString(formData, "documentId");
  const bundleId = getFormString(formData, "knowledgeBundleId");
  const db = getPrisma();
  const [document, bundle] = await Promise.all([
    db.document.findFirst({ where: { deletedAt: null, id: documentId, workspaceId: context.workspaceId } }),
    db.knowledgeBundle.findFirst({ where: { id: bundleId, status: "active", workspaceId: context.workspaceId } }),
  ]);
  if (!document) throw new Error("document_not_found");
  if (document.knowledgeBundleId) throw new Error("document_already_assigned");
  if (!bundle) throw new Error("knowledge_bundle_not_found");
  await db.document.update({
    data: { knowledgeBundleId: bundle.id, ragStatus: "not_indexed" },
    where: { id: document.id },
  });
  revalidatePath("/documents");
  revalidatePath(`/documents/${document.id}`);
  revalidatePath("/knowledge");
  redirect(`/documents/${document.id}?panel=summary`);
}

export async function generateTopicsAction(formData: FormData) {
  const id = getFormString(formData, "id");
  let result = "queued";
  if (isProductionBackend()) {
    await requestTopicDiscovery({
      context: await requireAuthWorkspaceContext(),
      documentId: id,
    });
  } else {
    result = String((await generateTopicRecords(id)).length);
  }

  revalidatePath("/dashboard");
  revalidatePath("/documents");
  revalidatePath(`/documents/${id}`);
  redirect(`/documents/${id}?panel=topics&topicsGenerated=${result}`);
}

export async function startKnowledgeAuthoringAction(formData: FormData) {
  const documentId = getFormString(formData, "documentId");
  const context = await requireAuthWorkspaceContext();
  const run = await createKnowledgeAuthoringRun({ context, documentId });
  await enqueueKnowledgeAuthoringRun(run);
  revalidatePath(`/documents/${documentId}`);
  redirect(getAuthoringReturnHref(documentId, formData));
}

export async function confirmKnowledgeAuthoringCostAction(formData: FormData) {
  const documentId = getFormString(formData, "documentId");
  const context = await requireAuthWorkspaceContext();
  const run = await confirmKnowledgeAuthoringCost({ context, runId: getFormString(formData, "runId") });
  await enqueueKnowledgeAuthoringRun(run);
  revalidatePath(`/documents/${documentId}`);
  redirect(getAuthoringReturnHref(documentId, formData));
}

export async function retryKnowledgeAuthoringAction(formData: FormData) {
  const documentId = getFormString(formData, "documentId");
  const context = await requireAuthWorkspaceContext();
  const runId = getFormString(formData, "runId");
  const prisma = (await import("@/lib/prisma")).getPrisma();
  const run = await prisma.knowledgeAuthoringRun.findFirst({ where: { documentId, id: runId, workspaceId: context.workspaceId } });
  if (!run) throw new Error("knowledge_authoring_workspace_mismatch");
  const queued = await prisma.knowledgeAuthoringRun.update({ data: { errorCode: null, errorMessage: null, status: "queued" }, where: { id: run.id } });
  await enqueueKnowledgeAuthoringRun(queued);
  revalidatePath(`/documents/${documentId}`);
  redirect(getAuthoringReturnHref(documentId, formData));
}

export async function retryEntityExtractionAction(formData: FormData) {
  const documentId = getFormString(formData, "documentId");
  const context = await requireAuthWorkspaceContext();
  const jobs = await getPrisma().entityExtractionJob.findMany({
    where: {
      documentId,
      status: { in: ["failed", "completed_with_warnings"] },
      workspaceId: context.workspaceId,
    },
  });
  const queue = getEntityGraphQueue();
  for (const job of jobs) {
    await getPrisma().entityExtractionJob.update({
      data: { completedAt: null, errorCode: null, errorMessage: null, status: "queued", warningCodes: [] },
      where: { id: job.id },
    });
    await queue.enqueue({ jobId: job.id, kind: "extract", workspaceId: job.workspaceId });
  }
  revalidatePath(`/documents/${documentId}`);
  redirect(`/documents/${documentId}?panel=processing`);
}

export async function undoAuthoringMetadataAction(formData: FormData) {
  const documentId = getFormString(formData, "documentId");
  await undoAuthoringMetadata({ context: await requireAuthWorkspaceContext(), proposalId: getFormString(formData, "proposalId") });
  revalidatePath(`/documents/${documentId}`);
  redirect(`/documents/${documentId}?panel=authoring`);
}

export async function promoteAuthoringRelationsAction(formData: FormData) {
  const documentId = getFormString(formData, "documentId");
  const result = await promoteAuthoringRelationSuggestions({
    context: await requireAuthWorkspaceContext(),
    runId: getFormString(formData, "runId"),
  });
  revalidatePath(`/documents/${documentId}`);
  revalidatePath(`/knowledge/${result.knowledgeBundleId}`);
  redirect(`/knowledge/${result.knowledgeBundleId}?relationsPromoted=${result.promoted}&relationsSkipped=${result.skipped}`);
}

async function enqueueKnowledgeAuthoringRun(run: { documentId: string; id: string; workspaceId: string }) {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error("missing_env_REDIS_URL");
  const queue = createBullMqKnowledgeAuthoringQueue(redisUrl);
  try {
    await queue.enqueue({ documentId: run.documentId, runId: run.id, workspaceId: run.workspaceId });
  } finally {
    await queue.close();
  }
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

export async function resolveTopicEnrichmentCandidateAction(formData: FormData) {
  const documentId = getFormString(formData, "documentId");
  const topicId = getFormString(formData, "topicId");
  const auditId = getFormString(formData, "auditId");
  const decisionValue = getFormString(formData, "decision");
  if (decisionValue !== "accept" && decisionValue !== "reject") {
    throw new Error("invalid_topic_enrichment_decision");
  }
  const context = await requireAuthWorkspaceContext();
  const workspaceId = await getDocumentWorkspaceId(documentId);
  assertActionDocumentWorkspace({
    allowMissingWorkspace: !isProductionBackend(),
    context,
    document: { workspaceId },
    mismatchError: "topic_enrichment_workspace_mismatch",
  });
  const topicBelongsToDocument = (await getTopicRecordsByDocumentId(documentId))
    .some((topic) => topic.id === topicId);
  if (!topicBelongsToDocument) {
    throw new Error("topic_not_found");
  }
  await resolveTopicEnrichmentCandidateDecision(
    topicId,
    { auditId, decision: decisionValue },
    { context },
  );
  revalidatePath(`/documents/${documentId}`);
  redirect(`/documents/${documentId}?panel=topics&topic=${topicId}`);
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

export async function resolveProposedTopicPagesAction(formData: FormData) {
  const documentId = getFormString(formData, "documentId");
  await resolveProposedTopicPages({
    accept: getFormString(formData, "decision") === "accept",
    context: await requireAuthWorkspaceContext(),
    topicId: getFormString(formData, "topicId"),
  });
  revalidatePath(`/documents/${documentId}`);
  redirect(`/documents/${documentId}?panel=topics&topic=${getFormString(formData, "topicId")}`);
}

export async function updateTopicOkfMetadataAction(formData: FormData) {
  const documentId = getFormString(formData, "documentId");
  const topicId = getFormString(formData, "topicId");
  const context = await requireAuthWorkspaceContext();
  const [document, topics] = await Promise.all([
    getDocumentById(documentId),
    getTopicRecordsByDocumentId(documentId),
  ]);
  if (!document) throw new Error("document_not_found");
  assertActionDocumentWorkspace({
    allowMissingWorkspace: !isProductionBackend(),
    context,
    document,
    mismatchError: "document_workspace_mismatch",
  });
  const topic = topics.find((candidate) => candidate.id === topicId);
  if (!topic) throw new Error("topic_not_found");
  if (!document.knowledgeBundleId) throw new Error("document_requires_active_knowledge_bundle");
  const bundle = await getKnowledgeBundleByIdentity({
    bundleId: document.knowledgeBundleId,
    workspaceId: context.workspaceId,
  });
  if (!bundle) throw new Error("knowledge_bundle_not_found");
  const metadata: Record<string, unknown> = {};
  for (const [field, definition] of Object.entries(bundle.profile.fields)) {
    if (["title", "description", "updated"].includes(field)) continue;
    const raw = getFormString(formData, `okfField__${field}`).trim();
    if (!raw) continue;
    metadata[field] = definition.type === "string_array"
      ? raw.split(",").map((value) => value.trim()).filter(Boolean)
      : definition.type === "number_array"
        ? raw.split(",").map((value) => Number(value.trim())).filter(Number.isFinite)
        : definition.type === "number"
          ? Number(raw)
          : raw;
  }
  await updateTopicOkfMetadata(topicId, metadata);
  revalidatePath(`/documents/${documentId}`);
  redirect(`/documents/${documentId}?panel=topics&topic=${topicId}`);
}

const RECOVERABLE_METADATA_ERRORS = new Set([
  "classification_code_too_long",
  "document_workspace_mismatch",
  "invalid_aviation_ata",
  "invalid_aviation_aircraft_type_id",
  "invalid_aviation_source_classification",
  "invalid_aviation_intended_audience",
  "aviation_intended_audience_required",
  "aviation_content_purpose_required",
  "invalid_aircraft_applicability_scope",
  "invalid_entire_family_applicability",
  "invalid_specific_variant_applicability",
  "invalid_ambiguous_applicability",
]);

export async function updateDocumentMetadataAction(formData: FormData) {
  const id = getFormString(formData, "id");

  try {
    const context = await requireAuthWorkspaceContext();
    const workspaceId = await getDocumentWorkspaceId(id);

    assertActionDocumentWorkspace({
      // Local Stage 1 JSON-vault records may predate workspace metadata.
      allowMissingWorkspace: !isProductionBackend(),
      context,
      document: { workspaceId },
      mismatchError: "document_workspace_mismatch",
    });

    const sourceType = getSourceType(getFormString(formData, "sourceType"));
    const aviation = getAviationMetadata(formData, sourceType);
    const currentDocument = await getDocumentById(id);
    const submittedSourceIdentifier = getNullableFormString(formData, "sourceIdentifier");
    const preservedSourceIdentifier = sourceType === "aviation" &&
      submittedSourceIdentifier === currentDocument?.classificationCode &&
      submittedSourceIdentifier !== null &&
      !/^\d{2}(?:-\d{2}){0,2}$/.test(submittedSourceIdentifier)
      ? submittedSourceIdentifier
      : null;
    const applicabilityManualOverride = sourceType === "aviation" && getFormString(formData, "applicabilityManualOverride") === "true";
    const applicability = applicabilityManualOverride
      ? normalizeManualAircraftApplicability({
          aircraftFamilyIds: getFormString(formData, "aircraftFamilyIds"),
          aircraftTypeIds: getFormString(formData, "aircraftTypeIds"),
          scope: getFormString(formData, "applicabilityScope"),
        })
      : null;
    await updateDocumentMetadata(id, {
      aircraftFamilyIds: applicability?.aircraftFamilyIds,
      aircraftTypeIds: aviation.aircraftTypeIds,
      applicabilityManualOverride,
      applicabilityOverrideBy: context.userId,
      applicabilityScope: applicability?.scope,
      subjectFamily: sourceType === "aviation"
        ? aviation.subjectFamily
        : getNullableFormString(formData, "subjectFamily"),
      classificationCode: sourceType === "aviation"
        ? aviation.classificationCode ?? preservedSourceIdentifier
        : normalizeClassificationCode(getNullableFormString(formData, "classificationCode")),
      contentPurpose: aviation.contentPurpose,
      customProperties: parseCustomProperties(
        getFormString(formData, "customProperties"),
      ),
      description: getFormString(formData, "description"),
      effectivity: sourceType === "aviation" ? aviation.effectivity : getNullableFormString(formData, "effectivity"),
      documentType: sourceType === "aviation" ? aviation.documentType : getNullableFormString(formData, "documentType"),
      intendedAudiences: aviation.intendedAudiences,
      licenseIdentifier: aviation.licenseIdentifier,
      owner: getFormString(formData, "owner"),
      revision: sourceType === "aviation" ? aviation.revision : getNullableFormString(formData, "revision"),
      sourceAuthority: sourceType === "aviation" ? aviation.sourceAuthority : getNullableFormString(formData, "sourceAuthority"),
      sourceClassification: aviation.sourceClassification,
      sourceType,
      status: getDocumentStatus(getFormString(formData, "status")),
      tags: parseTags(getFormString(formData, "tags")),
      title: getFormString(formData, "title"),
    });
    if (isProductionBackend() && sourceType === "aviation") {
      const readyRun = await getPrisma().knowledgeAuthoringRun.findFirst({
        orderBy: { updatedAt: "desc" },
        select: { id: true },
        where: { documentId: id, status: "ready_for_review", workspaceId: context.workspaceId },
      });
      if (readyRun) {
        const queue = createEfbReleaseQueue();
        try {
          await createAutomaticPocEfbReleaseJob({ authoringRunId: readyRun.id, queue });
        } catch (error) {
          console.error("efb_release_enqueue_after_metadata_update_failed", error);
        } finally {
          await queue.close();
        }
      }
    }
  } catch (error) {
    if (error instanceof Error && RECOVERABLE_METADATA_ERRORS.has(error.message)) {
      redirect(
        `/documents/${id}?panel=metadata&metadataError=${encodeURIComponent(error.message)}`,
      );
    }

    throw error;
  }

  revalidatePath("/dashboard");
  revalidatePath("/documents");
  revalidatePath(`/documents/${id}`);
  redirect(`/documents/${id}`);
}

export async function permanentDeleteDocumentAction(formData: FormData) {
  const id = getFormString(formData, "id");
  const context = await requireAuthWorkspaceContext();

  if (!isProductionBackend()) {
    redirect(
      `/documents/${id}?deleteError=${encodeURIComponent(
        "lifecycle_requires_production_backend",
      )}`,
    );
  }

  const job = await requestPermanentDocumentDeletion({ context, documentId: id });

  revalidatePath("/dashboard");
  revalidatePath("/documents");
  revalidatePath("/knowledge");
  revalidatePath("/knowledge/bundle");
  redirect(`/documents?deletionJob=${encodeURIComponent(job.id)}`);
}

export async function retryPermanentDocumentDeletionAction(formData: FormData) {
  const context = await requireAuthWorkspaceContext();
  await retryPermanentDocumentDeletion({
    context,
    jobId: getFormString(formData, "jobId"),
  });
  revalidatePath("/documents");
  redirect(`/documents?deletionJob=${encodeURIComponent(getFormString(formData, "jobId"))}`);
}

function getFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function getAviationMetadata(formData: FormData, sourceType: SourceType) {
  if (sourceType !== "aviation") {
    return {
      ...emptyAviationDocumentMetadata(),
      classificationCode: null,
      documentType: null,
      effectivity: null,
      revision: null,
      sourceAuthority: null,
      subjectFamily: null,
    };
  }
  return normalizeAviationDocumentMetadata({
    aircraftFamily: getNullableFormString(formData, "subjectFamily"),
    aircraftTypeIds: getFormString(formData, "aircraftTypeIds"),
    ata: getNullableFormString(formData, "classificationCode"),
    contentPurpose: getNullableFormString(formData, "contentPurpose"),
    effectivity: getNullableFormString(formData, "effectivity"),
    intendedAudiences: formData.getAll("intendedAudiences"),
    licenseIdentifier: getNullableFormString(formData, "licenseIdentifier"),
    manualType: getNullableFormString(formData, "documentType"),
    revision: getNullableFormString(formData, "revision"),
    sourceAuthority: getNullableFormString(formData, "sourceAuthority"),
    sourceClassification: getNullableFormString(formData, "sourceClassification"),
  });
}

function getAuthoringReturnHref(documentId: string, formData: FormData) {
  const returnPanel = getFormString(formData, "returnPanel");
  return `/documents/${documentId}?panel=${returnPanel === "processing" ? "processing" : "authoring"}`;
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

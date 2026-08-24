import { createHash } from "node:crypto";

import type { AuthWorkspaceContext } from "./auth-workspace.ts";
import { createPostgresDocumentRepository } from "./production-repository.ts";
import { getPrisma } from "./prisma.ts";
import { exportApprovedTopicForDocument } from "./okf-export-service.ts";
import { getKnowledgeBundleByIdentity } from "./knowledge-bundles.ts";
import { getTokenCounter } from "./rag-tokenizer.ts";
import { normalizeKnowledgeProfile, type KnowledgeProfileSchema } from "./knowledge-profile.ts";
import type { BulkTopicApprovalJobPayload } from "./bulk-topic-approval-queue.ts";
import { approveTopicContentSource } from "./topic-enrichment.ts";
import type { OperationProgressSnapshot } from "./operation-progress.ts";

type ReviewTopic = {
  confidence: string;
  documentId: string;
  documentTitle: string;
  eligible: boolean;
  eligibilityErrors: string[];
  enrichedBody: string | null;
  enrichedSummary: string | null;
  enrichedTitle: string | null;
  enrichmentLevel: "complete" | "partial" | "not_enriched";
  enrichmentScore: number;
  enrichmentStatus: string;
  exportedFilePath: string | null;
  id: string;
  okfType: string;
  overlapWarnings: string[];
  origin: "document_discovery" | "topic_expansion";
  pageEnd: number;
  pageStart: number;
  proposedSourcePageNumbers: number[];
  reviewStatus: string;
  sourcePageNumbers: number[];
};

type TopicLike = {
  bulkApprovalRunId?: string | null;
  confidence: string;
  documentId: string;
  enrichedBody: string | null;
  enrichedSummary: string | null;
  enrichedTitle: string | null;
  enrichmentStatus: string;
  exportedFilePath: string | null;
  id: string;
  knowledgeBundleId: string;
  okfMetadata: unknown;
  proposedSourcePageNumbers: number[];
  reviewStatus: string;
  sourcePageNumbers: number[];
  updatedAt: Date;
  workspaceId: string;
};

type DocumentMetadataLike = {
  classificationCode?: string | null;
  documentType?: string | null;
  effectivity?: string | null;
  revision?: string | null;
  sourceAuthority?: string | null;
  subjectFamily?: string | null;
  tags?: string[];
  title: string;
};

type BulkRunStatusLike = {
  errorCode: string | null;
  errorMessage: string | null;
  id: string;
  items: Array<{
    exportedFilePath: string | null;
    failureCode: string | null;
    failureMessage: string | null;
    id: string;
    retryCount: number;
    status: string;
    topic?: { enrichedTitle: string | null; title: string };
  }>;
  status: string;
};

export type BulkTopicApprovalProgressData = { errorCode: string | null; errorMessage: string | null; items: Array<{ exportedFilePath: string | null; failureCode: string | null; failureMessage: string | null; id: string; status: string; title: string }>; runId: string; status: string };
export type BulkTopicApprovalStatusSnapshot = OperationProgressSnapshot<BulkTopicApprovalProgressData>;

export function bulkTopicSelectionFingerprint(input: {
  bundleId: string;
  topicIds: string[];
  workspaceId: string;
}): string {
  return createHash("sha256")
    .update(JSON.stringify({
      bundleId: input.bundleId,
      topicIds: [...new Set(input.topicIds.filter(Boolean))].sort(),
      workspaceId: input.workspaceId,
    }))
    .digest("hex");
}

export async function createOrReuseBulkPreflight<T>(input: {
  create: () => Promise<T>;
  findExisting: () => Promise<T | null>;
}): Promise<T> {
  const existing = await input.findExisting();
  if (existing) return existing;
  try {
    return await input.create();
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const winner = await input.findExisting();
    if (!winner) throw error;
    return winner;
  }
}

export function topicRevisionFingerprint(topic: TopicLike): string {
  return createHash("sha256").update(JSON.stringify({
    confidence: topic.confidence,
    enrichedBody: topic.enrichedBody,
    enrichedSummary: topic.enrichedSummary,
    enrichedTitle: topic.enrichedTitle,
    okfMetadata: topic.okfMetadata,
    reviewStatus: topic.reviewStatus,
    sourcePageNumbers: bulkApprovalSourcePageNumbers(topic),
    updatedAt: topic.updatedAt.toISOString(),
  })).digest("hex");
}

export function findPageOverlapErrors(
  selected: Array<{ documentId: string; id: string; sourcePageNumbers: number[] }>,
  approved: Array<{ documentId: string; id: string; sourcePageNumbers: number[] }>,
): string[] {
  const errors: string[] = [];
  for (let left = 0; left < selected.length; left += 1) {
    for (let right = left + 1; right < selected.length; right += 1) {
      if (topicsOverlap(selected[left]!, selected[right]!)) {
        errors.push(`bulk_topic_page_overlap:${selected[left]!.id}:${selected[right]!.id}`);
      }
    }
  }
  for (const topic of selected) {
    for (const prior of approved) {
      if (topicsOverlap(topic, prior)) {
        errors.push(`bulk_topic_overlaps_approved:${topic.id}:${prior.id}`);
      }
    }
  }
  return errors;
}

export function shouldBlockBulkPageOverlap(mode: string): boolean {
  return mode === "automated";
}

export function bulkApprovalSourcePageNumbers(topic: {
  proposedSourcePageNumbers: number[];
  sourcePageNumbers: number[];
}): number[] {
  return [...new Set([...topic.sourcePageNumbers, ...topic.proposedSourcePageNumbers])]
    .sort((left, right) => left - right);
}

export function buildTopicEnrichmentAssessment(topic: {
  enrichedBody: string | null;
  enrichedSummary: string | null;
  enrichedTitle: string | null;
  enrichmentStatus: string;
  sourcePageNumbers: number[];
}): { level: "complete" | "partial" | "not_enriched"; score: number } {
  const checks = [
    topic.enrichmentStatus === "completed",
    Boolean(topic.enrichedTitle?.trim()),
    Boolean(topic.enrichedSummary?.trim()),
    Boolean(topic.enrichedBody?.trim()),
    topic.sourcePageNumbers.length > 0,
  ];
  const score = checks.filter(Boolean).length * 20;
  return {
    level: score === 100 ? "complete" : score === 0 ? "not_enriched" : "partial",
    score,
  };
}

export async function listBulkReviewTopics(input: {
  bundleId: string;
  context: AuthWorkspaceContext;
  documentId?: string;
}): Promise<ReviewTopic[]> {
  const bundle = await getKnowledgeBundleByIdentity({
    bundleId: input.bundleId,
    workspaceId: input.context.workspaceId,
  });
  if (!bundle) throw new Error("knowledge_bundle_not_found");
  const topics = await getPrisma().topicRecord.findMany({
    include: { document: true },
    orderBy: [{ document: { title: "asc" } }, { pageStart: "asc" }, { id: "asc" }],
    where: {
      ...(input.documentId ? { documentId: input.documentId } : {}),
      document: { deletedAt: null },
      knowledgeBundleId: input.bundleId,
      workspaceId: input.context.workspaceId,
    },
  });
  const reviewTopics: ReviewTopic[] = topics.map((topic) => {
    const eligibilityErrors = topicEligibilityErrors(topic, bundle.profile, topic.document);
    const enrichment = buildTopicEnrichmentAssessment(topic);
    return {
      confidence: topic.confidence,
      documentId: topic.documentId,
      documentTitle: topic.document.title,
      eligible: eligibilityErrors.length === 0,
      eligibilityErrors,
      enrichedBody: topic.enrichedBody,
      enrichedSummary: topic.enrichedSummary,
      enrichedTitle: topic.enrichedTitle,
      enrichmentLevel: enrichment.level,
      enrichmentScore: enrichment.score,
      enrichmentStatus: topic.enrichmentStatus,
      exportedFilePath: topic.exportedFilePath,
      id: topic.id,
      okfType: getOkfType(topic.okfMetadata),
      overlapWarnings: [],
      origin: isTopicExpansionMetadata(topic.discoveryMetadata) ? "topic_expansion" : "document_discovery",
      pageEnd: topic.pageEnd,
      pageStart: topic.pageStart,
      proposedSourcePageNumbers: topic.proposedSourcePageNumbers,
      reviewStatus: topic.reviewStatus,
      sourcePageNumbers: topic.sourcePageNumbers,
    };
  });
  for (const topic of reviewTopics.filter((candidate) => candidate.eligible)) {
    const topicPages = bulkApprovalSourcePageNumbers(topic);
    for (const other of reviewTopics) {
      if (other.id === topic.id || other.documentId !== topic.documentId) continue;
      if (other.reviewStatus !== "approved" && !other.eligible) continue;
      const otherPages = other.reviewStatus === "approved"
        ? other.sourcePageNumbers
        : bulkApprovalSourcePageNumbers(other);
      const sharedPages = intersectPages(topicPages, otherPages);
      if (sharedPages.length === 0) continue;
      const otherTitle = other.enrichedTitle?.trim() || "another topic";
      const approvalLabel = other.reviewStatus === "approved" ? "approved topic " : "";
      topic.overlapWarnings.push(
        `Shares ${formatPageList(sharedPages)} with ${approvalLabel}${otherTitle}.`,
      );
    }
    topic.overlapWarnings.sort((left, right) => left.localeCompare(right));
  }
  return reviewTopics;
}

function isTopicExpansionMetadata(value: unknown) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && "origin" in value && value.origin === "topic_expansion");
}

export async function createBulkTopicApprovalPreflight(input: {
  bundleId: string;
  context: AuthWorkspaceContext;
  topicIds: string[];
}) {
  const topicIds = [...new Set(input.topicIds.filter(Boolean))];
  if (topicIds.length === 0) throw new Error("bulk_topic_selection_required");
  const selectionFingerprint = bulkTopicSelectionFingerprint({
    bundleId: input.bundleId,
    topicIds,
    workspaceId: input.context.workspaceId,
  });
  const db = getPrisma();
  const findExisting = () => db.bulkTopicApprovalRun.findFirst({
    include: { items: { include: { document: true, topic: true }, orderBy: { createdAt: "asc" } } },
    where: {
      knowledgeBundleId: input.bundleId,
      mode: "human",
      selectionFingerprint,
      workspaceId: input.context.workspaceId,
    },
  });
  const existing = await findExisting();
  if (existing) return existing;
  const bundle = await getKnowledgeBundleByIdentity({ bundleId: input.bundleId, workspaceId: input.context.workspaceId });
  if (!bundle) throw new Error("knowledge_bundle_not_found");
  const topics = await db.topicRecord.findMany({
    include: { document: true },
    where: { id: { in: topicIds }, knowledgeBundleId: input.bundleId, workspaceId: input.context.workspaceId },
  });
  if (topics.length !== topicIds.length) throw new Error("bulk_topic_selection_scope_mismatch");
  const eligibilityErrors = topics.flatMap((topic) => topicEligibilityErrors(topic, bundle.profile, topic.document).map((error) => `${topic.id}:${error}`));
  const errors = eligibilityErrors;
  if (errors.length > 0) throw new Error(`bulk_topic_preflight_failed:${errors.join(",")}`);
  const tokenCounter = getTokenCounter();
  const items = topics.map((topic) => ({
    documentId: topic.documentId,
    estimatedEmbeddingTokens: tokenCounter.count(buildEmbeddingEstimateText(bundle.name, topic)),
    knowledgeBundleId: input.bundleId,
    revisionFingerprint: topicRevisionFingerprint(topic),
    status: "pending",
    topicId: topic.id,
    workspaceId: input.context.workspaceId,
  }));
  return createOrReuseBulkPreflight({
    create: () => db.bulkTopicApprovalRun.create({
      data: {
        estimatedEmbeddingTokens: items.reduce((total, item) => total + item.estimatedEmbeddingTokens, 0),
        items: { create: items },
        knowledgeBundleId: input.bundleId,
        requestedBy: input.context.userId,
        selectionFingerprint,
        workspaceId: input.context.workspaceId,
      },
      include: { items: { include: { document: true, topic: true }, orderBy: { createdAt: "asc" } } },
    }),
    findExisting,
  });
}

export async function getBulkTopicApprovalRun(input: { context: AuthWorkspaceContext; runId: string }) {
  return getPrisma().bulkTopicApprovalRun.findFirst({
    include: { items: { include: { document: true, topic: true }, orderBy: { createdAt: "asc" } }, knowledgeBundle: true },
    where: { id: input.runId, workspaceId: input.context.workspaceId },
  });
}

export async function listAwaitingBulkTopicApprovalRuns(input: {
  bundleId: string;
  context: AuthWorkspaceContext;
  documentId?: string;
}) {
  const runs = await getPrisma().bulkTopicApprovalRun.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      createdAt: true,
      id: true,
      items: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          revisionFingerprint: true,
          topic: true,
        },
      },
    },
    take: 5,
    where: {
      knowledgeBundleId: input.bundleId,
      mode: "human",
      status: "awaiting_confirmation",
      workspaceId: input.context.workspaceId,
      ...(input.documentId
        ? { items: { some: { documentId: input.documentId } } }
        : {}),
    },
  });
  return runs.filter(isBulkTopicApprovalRunConfirmable);
}

export function isBulkTopicApprovalRunConfirmable(run: {
  items: Array<{
    revisionFingerprint: string;
    topic: TopicLike;
  }>;
}) {
  return run.items.length > 0 && run.items.every((item) =>
    item.topic.reviewStatus === "needs_review" &&
    topicRevisionFingerprint(item.topic) === item.revisionFingerprint,
  );
}

export async function getBulkTopicApprovalStatusSnapshot(input: {
  context: AuthWorkspaceContext;
  runId: string;
}): Promise<BulkTopicApprovalStatusSnapshot | null> {
  const run = await getPrisma().bulkTopicApprovalRun.findFirst({
    select: {
      errorCode: true,
      errorMessage: true,
      id: true,
      items: {
        orderBy: { id: "asc" },
        select: {
          exportedFilePath: true,
          failureCode: true,
          failureMessage: true,
          id: true,
          retryCount: true,
          status: true,
          topic: { select: { enrichedTitle: true, title: true } },
        },
      },
      status: true,
    },
    where: { id: input.runId, workspaceId: input.context.workspaceId },
  });

  return run ? buildBulkTopicApprovalStatusSnapshot(run) : null;
}

export function buildBulkTopicApprovalStatusSnapshot(
  run: BulkRunStatusLike,
): BulkTopicApprovalStatusSnapshot {
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        errorCode: run.errorCode,
        errorMessage: run.errorMessage,
        id: run.id,
        items: run.items
          .map((item) => ({
            exportedFilePath: item.exportedFilePath,
            failureCode: item.failureCode,
            failureMessage: item.failureMessage,
            id: item.id,
            retryCount: item.retryCount,
            status: item.status,
          }))
          .sort((left, right) => left.id.localeCompare(right.id)),
        status: run.status,
      }),
    )
    .digest("hex");

  return {
    active: ["queued", "running"].includes(run.status),
    data: { errorCode: run.errorCode, errorMessage: run.errorMessage, items: run.items.map((item) => ({ exportedFilePath: item.exportedFilePath, failureCode: item.failureCode, failureMessage: item.failureMessage, id: item.id, status: item.status, title: item.topic?.enrichedTitle ?? item.topic?.title ?? "Topic" })), runId: run.id, status: run.status },
    fingerprint,
    generatedAt: new Date().toISOString(),
    operations: [{ completed: run.items.filter((item) => ["succeeded", "failed"].includes(item.status)).length, currentItem: run.items.find((item) => ["approving", "exporting"].includes(item.status))?.topic?.enrichedTitle ?? run.items.find((item) => ["approving", "exporting"].includes(item.status))?.topic?.title, detail: `${run.items.filter((item) => ["succeeded", "failed"].includes(item.status)).length} of ${run.items.length} topics finished`, id: run.id, kind: "bulk_topic_approval", label: "Approval and export", stage: run.items.find((item) => ["approving", "exporting"].includes(item.status))?.status ?? run.status, status: run.status === "completed_with_failures" ? "completed_with_warnings" : run.status === "failed" ? "failed" : run.status === "completed" ? "completed" : run.status === "awaiting_confirmation" ? "action_required" : run.status === "queued" ? "queued" : "running", total: run.items.length, updatedAt: new Date().toISOString() }],
  };
}

export function summarizeBulkTopicApprovalProgress(items: Array<{
  status: string;
  topic: { enrichedTitle: string | null; title: string };
}>) {
  const succeeded = items.filter((item) => item.status === "succeeded").length;
  const failed = items.filter((item) => item.status === "failed").length;
  const inProgress = items.filter((item) => ["approving", "exporting"].includes(item.status)).length;
  const pending = items.filter((item) => item.status === "pending").length;
  const active = items.find((item) => ["approving", "exporting"].includes(item.status));
  return {
    activeTitle: active?.topic.enrichedTitle ?? active?.topic.title ?? null,
    completed: succeeded + failed,
    failed,
    inProgress,
    pending,
    succeeded,
    total: items.length,
  };
}

export async function confirmBulkTopicApprovalRun(input: {
  context: AuthWorkspaceContext;
  enqueue: (payload: BulkTopicApprovalJobPayload) => Promise<void>;
  runId: string;
}) {
  const run = await getBulkTopicApprovalRun(input);
  if (!run) throw new Error("bulk_topic_approval_run_not_found");
  if (run.status !== "awaiting_confirmation") throw new Error("bulk_topic_approval_run_not_confirmable");
  for (const item of run.items) {
    if (topicRevisionFingerprint(item.topic) !== item.revisionFingerprint) {
      throw new Error(`bulk_topic_changed_since_preflight:${item.topicId}`);
    }
  }
  const updated = await getPrisma().bulkTopicApprovalRun.update({
    data: { confirmedAt: new Date(), confirmedBy: input.context.userId, status: "queued" },
    where: { id: run.id },
  });
  try {
    await input.enqueue({ runId: run.id, workspaceId: run.workspaceId });
  } catch (error) {
    console.error("bulk_topic_approval_enqueue_failed", error);
  }
  return updated;
}

export async function retryBulkTopicApprovalRun(input: {
  context: AuthWorkspaceContext;
  enqueue: (payload: BulkTopicApprovalJobPayload) => Promise<void>;
  runId: string;
}) {
  const run = await getBulkTopicApprovalRun(input);
  if (!run) throw new Error("bulk_topic_approval_run_not_found");
  const failed = run.items.filter((item) => item.status === "failed" && isRetryableBulkFailure(item.failureCode));
  if (failed.length === 0) throw new Error("bulk_topic_approval_no_failed_items");
  await getPrisma().$transaction([
    getPrisma().bulkTopicApprovalItem.updateMany({
      data: { failureCode: null, failureMessage: null, retryCount: { increment: 1 }, status: "pending" },
      where: { id: { in: failed.map((item) => item.id) } },
    }),
    getPrisma().bulkTopicApprovalRun.update({ data: { completedAt: null, status: "queued" }, where: { id: run.id } }),
  ]);
  await input.enqueue({ runId: run.id, workspaceId: run.workspaceId });
}

export function isRetryableBulkFailure(code: string | null): boolean {
  return ![
    "bulk_topic_already_processed",
    "bulk_topic_changed_since_confirmation",
    "bulk_topic_overlaps_approved",
    "topic_already_approved",
    "topic_rejected",
  ].includes(code ?? "");
}

export async function runBulkTopicApprovalJob(payload: BulkTopicApprovalJobPayload) {
  const db = getPrisma();
  const run = await db.bulkTopicApprovalRun.findFirst({
    include: { items: { orderBy: { createdAt: "asc" } } },
    where: { id: payload.runId, workspaceId: payload.workspaceId },
  });
  if (!run) throw new Error("bulk_topic_approval_run_not_found");
  if (!["queued", "running"].includes(run.status)) return run;
  await db.bulkTopicApprovalRun.update({ data: { startedAt: run.startedAt ?? new Date(), status: "running" }, where: { id: run.id } });
  for (const item of run.items.filter((candidate) => ["pending", "approving", "exporting"].includes(candidate.status))) {
    await processBulkItem({ itemId: item.id, mode: run.mode, requestedBy: run.requestedBy, runId: run.id, workspaceId: run.workspaceId });
  }
  const statuses = await db.bulkTopicApprovalItem.groupBy({ by: ["status"], _count: true, where: { runId: run.id } });
  const failed = statuses.find((entry) => entry.status === "failed")?._count ?? 0;
  const succeeded = statuses.find((entry) => entry.status === "succeeded")?._count ?? 0;
  const total = statuses.reduce((sum, entry) => sum + entry._count, 0);
  const completedRun = await db.bulkTopicApprovalRun.update({
    data: { completedAt: new Date(), status: failed === 0 ? "completed" : succeeded > 0 ? "completed_with_failures" : total > 0 ? "failed" : "completed" },
    where: { id: run.id },
  });
  const { reconcileAutomaticAuthoringRelationsForDocument } = await import(
    "./knowledge-authoring.ts"
  );
  for (const documentId of new Set(run.items.map((item) => item.documentId))) {
    await reconcileAutomaticAuthoringRelationsForDocument({
      documentId,
      workspaceId: run.workspaceId,
    });
  }
  return completedRun;
}

export async function reconcileBulkTopicApprovalRuns(enqueue: (payload: BulkTopicApprovalJobPayload) => Promise<void>) {
  const runs = await getPrisma().bulkTopicApprovalRun.findMany({ where: { status: { in: ["queued", "running"] } } });
  for (const run of runs) await enqueue({ runId: run.id, workspaceId: run.workspaceId });
}

export async function createAutomaticBulkApprovalRun(input: {
  authoringRunId: string;
  enqueue: (payload: BulkTopicApprovalJobPayload) => Promise<void>;
}) {
  const db = getPrisma();
  const existing = await db.bulkTopicApprovalRun.findUnique({
    where: { authoringRunId: input.authoringRunId },
  });
  if (existing) return existing;

  const authoringRun = await db.knowledgeAuthoringRun.findUnique({
    where: { id: input.authoringRunId },
  });
  if (!authoringRun || !authoringRun.automaticTopicApprovalEnabled) return null;

  const profileVersion = await db.knowledgeBundleProfileVersion.findFirst({
    where: {
      bundleId: authoringRun.knowledgeBundleId,
      version: authoringRun.profileVersion,
    },
  });
  if (!profileVersion) throw new Error("knowledge_authoring_profile_snapshot_missing");
  const profile = normalizeKnowledgeProfile(
    profileVersion.schema as unknown as KnowledgeProfileSchema,
  );
  const topics = await db.topicRecord.findMany({
    include: { document: true },
    orderBy: [{ pageStart: "asc" }, { id: "asc" }],
    where: {
      documentId: authoringRun.documentId,
      knowledgeBundleId: authoringRun.knowledgeBundleId,
      reviewStatus: { not: "approved" },
      workspaceId: authoringRun.workspaceId,
    },
  });
  const approved = await db.topicRecord.findMany({
    select: { documentId: true, id: true, sourcePageNumbers: true },
    where: {
      documentId: authoringRun.documentId,
      reviewStatus: "approved",
      workspaceId: authoringRun.workspaceId,
    },
  });
  const blockers = automaticTopicBlockers(topics, approved, profile);
  const tokenCounter = getTokenCounter();
  const bundle = await getKnowledgeBundleByIdentity({
    bundleId: authoringRun.knowledgeBundleId,
    workspaceId: authoringRun.workspaceId,
  });
  if (!bundle) throw new Error("knowledge_bundle_not_found");
  const items = topics.map((topic) => {
    const reasons = blockers.get(topic.id) ?? [];
    const eligible = reasons.length === 0;
    return {
      documentId: topic.documentId,
      estimatedEmbeddingTokens: eligible
        ? tokenCounter.count(buildEmbeddingEstimateText(bundle.name, topic))
        : 0,
      failureCode: eligible ? null : reasons[0],
      failureMessage: eligible ? null : reasons.join(","),
      knowledgeBundleId: authoringRun.knowledgeBundleId,
      revisionFingerprint: topicRevisionFingerprint(topic),
      status: eligible ? "pending" : "skipped",
      topicId: topic.id,
      workspaceId: authoringRun.workspaceId,
    };
  });
  const pending = items.filter((item) => item.status === "pending");

  let created;
  try {
    created = await db.bulkTopicApprovalRun.create({
      data: {
        authoringRunId: authoringRun.id,
        completedAt: pending.length === 0 ? new Date() : null,
        confirmedAt: new Date(),
        confirmedBy: authoringRun.requestedBy ?? "knowledge-authoring-system",
        estimatedEmbeddingTokens: pending.reduce(
          (total, item) => total + item.estimatedEmbeddingTokens,
          0,
        ),
        items: { create: items },
        knowledgeBundleId: authoringRun.knowledgeBundleId,
        mode: "automated",
        requestedBy: authoringRun.requestedBy ?? "knowledge-authoring-system",
        status: pending.length === 0 ? "completed" : "queued",
        workspaceId: authoringRun.workspaceId,
      },
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    return db.bulkTopicApprovalRun.findUnique({
      where: { authoringRunId: authoringRun.id },
    });
  }

  if (pending.length > 0) {
    try {
      await input.enqueue({ runId: created.id, workspaceId: created.workspaceId });
    } catch (error) {
      console.error("automatic_bulk_topic_approval_enqueue_failed", error);
    }
  }
  return created;
}

export function automaticTopicEligibilityErrors(
  topic: TopicLike,
  profile: KnowledgeProfileSchema,
  document?: DocumentMetadataLike,
): string[] {
  const errors = topicEligibilityErrors(topic, profile, document);
  if (topic.reviewStatus !== "needs_review") {
    errors.push("automatic_topic_requires_needs_review");
  }
  if (topic.confidence !== "high") {
    errors.push("automatic_topic_requires_high_confidence");
  }
  return [...new Set(errors)];
}

export function automaticTopicBlockers(
  topics: Array<TopicLike & { document: DocumentMetadataLike }>,
  approved: Array<{ documentId: string; id: string; sourcePageNumbers: number[] }>,
  profile: KnowledgeProfileSchema,
): Map<string, string[]> {
  const blockers = new Map(
    topics.map((topic) => [
      topic.id,
      automaticTopicEligibilityErrors(topic, profile, topic.document),
    ]),
  );
  const candidates = topics.filter((topic) => blockers.get(topic.id)?.length === 0);
  for (let left = 0; left < candidates.length; left += 1) {
    for (let right = left + 1; right < candidates.length; right += 1) {
      const first = candidates[left]!;
      const second = candidates[right]!;
      if (!topicsOverlap(first, second)) continue;
      blockers.get(first.id)!.push(`bulk_topic_page_overlap:${first.id}:${second.id}`);
      blockers.get(second.id)!.push(`bulk_topic_page_overlap:${second.id}:${first.id}`);
    }
  }
  for (const topic of candidates) {
    for (const prior of approved) {
      if (topicsOverlap(topic, prior)) {
        blockers.get(topic.id)!.push(`bulk_topic_overlaps_approved:${topic.id}:${prior.id}`);
      }
    }
  }
  return blockers;
}

async function processBulkItem(input: { itemId: string; mode: string; requestedBy: string; runId: string; workspaceId: string }) {
  const db = getPrisma();
  try {
    const item = await db.bulkTopicApprovalItem.findFirst({ include: { topic: true }, where: { id: input.itemId, runId: input.runId, workspaceId: input.workspaceId } });
    if (!item) throw new Error("bulk_topic_approval_item_not_found");
    const context: AuthWorkspaceContext = { role: "admin", userId: input.requestedBy, workspaceId: input.workspaceId };
    const repository = createPostgresDocumentRepository(db);
    if (shouldApproveBulkTopic({ bulkApprovalRunId: item.topic.bulkApprovalRunId, reviewStatus: item.topic.reviewStatus, runId: input.runId })) {
      if (topicRevisionFingerprint(item.topic) !== item.revisionFingerprint) throw new Error("bulk_topic_changed_since_confirmation");
      const documentRecord = await db.document.findFirst({ where: { deletedAt: null, id: item.documentId, workspaceId: input.workspaceId } });
      const bundle = await getKnowledgeBundleByIdentity({ bundleId: item.knowledgeBundleId, workspaceId: input.workspaceId });
      if (!documentRecord || !bundle) throw new Error("bulk_topic_scope_unavailable");
      const errors = input.mode === "automated"
        ? automaticTopicEligibilityErrors(item.topic, bundle.profile, documentRecord)
        : topicEligibilityErrors(item.topic, bundle.profile, documentRecord);
      if (errors.length > 0) throw new Error(errors[0]);
      const approvalPages = bulkApprovalSourcePageNumbers(item.topic);
      if (shouldBlockBulkPageOverlap(input.mode)) {
        const approved = await db.topicRecord.findMany({
          select: { documentId: true, id: true, sourcePageNumbers: true },
          where: { documentId: item.documentId, id: { not: item.topicId }, reviewStatus: "approved", workspaceId: input.workspaceId },
        });
        const overlap = findPageOverlapErrors(
          [{ ...item.topic, sourcePageNumbers: approvalPages }],
          approved,
        );
        if (overlap.length > 0) throw new Error(overlap[0]);
      }
      await claimBulkTopicForRun({
        runId: input.runId,
        topicId: item.topicId,
        updateMany: (args) => db.topicRecord.updateMany(args),
        workspaceId: input.workspaceId,
      });
      if (item.topic.proposedSourcePageNumbers.length > 0) {
        await db.$transaction(async (tx) => {
          const promotedTopic = await tx.topicRecord.update({
            data: {
              pageEnd: Math.max(...approvalPages),
              pageStart: Math.min(...approvalPages),
              proposedSourcePageNumbers: [],
              sourcePageNumbers: approvalPages,
            },
            where: { id: item.topic.id },
          });
          await tx.bulkTopicApprovalItem.update({
            data: { revisionFingerprint: topicRevisionFingerprint(promotedTopic) },
            where: { id: item.id },
          });
        });
      }
      await db.bulkTopicApprovalItem.update({ data: { startedAt: item.startedAt ?? new Date(), status: "approving" }, where: { id: item.id } });
      await approveTopicContentSource(item.topicId, "enriched", {
        approvalMode: input.mode === "automated" ? "automated" : "human_bulk",
        approvedAt: new Date(),
        approvedBy: input.requestedBy,
        context,
        repository: { approveTopicContent: repository.approveTopicContent },
      });
    }
    await db.bulkTopicApprovalItem.update({ data: { status: "exporting" }, where: { id: item.id } });
    const document = await repository.getDocumentById({ context, documentId: item.documentId });
    const topics = await repository.getTopicRecordsByDocumentId({ context, documentId: item.documentId });
    const exported = await exportApprovedTopicForDocument({ document, topicId: item.topicId, topics });
    await repository.updateTopicExportedFilePath({ context, exportedFilePath: exported.filename, topicId: item.topicId });
    await db.bulkTopicApprovalItem.update({ data: { completedAt: new Date(), exportedFilePath: exported.filename, failureCode: null, failureMessage: null, status: "succeeded" }, where: { id: item.id } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.bulkTopicApprovalItem.update({ data: { completedAt: new Date(), failureCode: message.split(":")[0], failureMessage: message, status: "failed" }, where: { id: input.itemId } });
  }
}

export function shouldApproveBulkTopic(input: { bulkApprovalRunId: string | null; reviewStatus: string; runId: string }): boolean {
  if (input.reviewStatus !== "approved") return true;
  if (input.bulkApprovalRunId !== input.runId) throw new Error("bulk_topic_already_processed");
  return false;
}

export async function claimBulkTopicForRun(input: {
  runId: string;
  topicId: string;
  updateMany: (args: {
    data: { bulkApprovalRunId: string };
    where: { bulkApprovalRunId: null; id: string; reviewStatus: { not: string }; workspaceId: string };
  }) => Promise<{ count: number }>;
  workspaceId: string;
}) {
  const claim = await input.updateMany({
    data: { bulkApprovalRunId: input.runId },
    where: { bulkApprovalRunId: null, id: input.topicId, reviewStatus: { not: "approved" }, workspaceId: input.workspaceId },
  });
  if (claim.count !== 1) throw new Error("bulk_topic_already_processed");
}

export function topicEligibilityErrors(topic: TopicLike, profile: KnowledgeProfileSchema, document?: DocumentMetadataLike): string[] {
  const errors: string[] = [];
  if (topic.reviewStatus === "approved") errors.push("topic_already_approved");
  else if (topic.reviewStatus === "rejected") errors.push("topic_rejected");
  if (topic.enrichmentStatus === "review_required") {
    errors.push("topic_enrichment_review_required");
  } else if (topic.enrichmentStatus !== "completed") {
    errors.push("topic_enrichment_not_completed");
  }
  if (!topic.enrichedTitle?.trim()) errors.push("topic_enriched_title_required");
  if (!topic.enrichedSummary?.trim()) errors.push("topic_enriched_summary_required");
  if (!topic.enrichedBody?.trim()) errors.push("topic_enriched_body_required");
  if (topic.sourcePageNumbers.length === 0) errors.push("topic_source_pages_required");
  const type = getOkfType(topic.okfMetadata);
  if (!profile.types[type]) errors.push(`knowledge_profile_type_not_allowed:${type}`);
  const metadata = topic.okfMetadata && typeof topic.okfMetadata === "object"
    ? topic.okfMetadata as Record<string, unknown>
    : {};
  const generatedFields = new Set([
    "av_okf_approval_mode",
    "description",
    "generated",
    "knowledge_version",
    "relations",
    "resource",
    "source_pages",
    "sources",
    "stale_after",
    "status",
    "tags",
    "title",
    "type",
    "verified",
  ]);
  const documentFields: Record<string, unknown> = {
    classification_code: document?.classificationCode,
    document_type: document?.documentType,
    effectivity: document?.effectivity,
    revision: document?.revision,
    source_authority: document?.sourceAuthority,
    subject_family: document?.subjectFamily,
    tags: metadata.tags ?? document?.tags,
  };
  for (const [field, definition] of Object.entries(profile.fields)) {
    if (!definition.required || generatedFields.has(field)) continue;
    const value = metadata[field] ?? documentFields[field];
    if (value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) {
      errors.push(`knowledge_profile_required_field_missing:${field}`);
    }
  }
  if (topic.bulkApprovalRunId) errors.push("bulk_topic_already_processed");
  return errors;
}

function buildEmbeddingEstimateText(bundleName: string, topic: TopicLike): string {
  return [`[Bundle: ${bundleName} | Type: ${getOkfType(topic.okfMetadata)}]`, topic.enrichedTitle, topic.enrichedSummary, topic.enrichedBody].filter(Boolean).join("\n");
}

function getOkfType(metadata: unknown): string {
  if (metadata && typeof metadata === "object" && "type" in metadata && typeof metadata.type === "string" && metadata.type.trim()) return metadata.type.trim();
  return "system_topic";
}

function topicsOverlap(left: { documentId: string; sourcePageNumbers: number[] }, right: { documentId: string; sourcePageNumbers: number[] }) {
  if (left.documentId !== right.documentId) return false;
  const pages = new Set(left.sourcePageNumbers);
  return right.sourcePageNumbers.some((page) => pages.has(page));
}

function intersectPages(left: number[], right: number[]): number[] {
  const rightPages = new Set(right);
  return [...new Set(left.filter((page) => rightPages.has(page)))]
    .sort((first, second) => first - second);
}

function formatPageList(pages: number[]): string {
  return `${pages.length === 1 ? "page" : "pages"} ${pages.join(", ")}`;
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

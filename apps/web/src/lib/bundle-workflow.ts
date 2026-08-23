import { createHash } from "node:crypto";

import type { AuthWorkspaceContext } from "./auth-workspace.ts";
import { getKnowledgeBundle } from "./knowledge-bundles.ts";
import { getPrisma } from "./prisma.ts";
import { isProductionBackend } from "./production-document-service.ts";

export type BundleWorkflowStatus =
  | "waiting"
  | "running"
  | "action_required"
  | "completed"
  | "completed_with_warnings"
  | "failed";

export type BundleWorkflowStage = {
  actionHref?: string;
  actionLabel?: string;
  detail: string;
  id: "documents" | "processing" | "publication" | "entities" | "connections" | "relation_review" | "chat";
  status: BundleWorkflowStatus;
  title: string;
};

export type BundleWorkflowFacts = {
  approvedTopicCount: number;
  assistantAnswerCount: number;
  bulkApprovalActive: number;
  bulkApprovalFailed: number;
  documentCount: number;
  entityCount: number;
  entityJobsActive: number;
  entityJobsCompleted: number;
  entityJobsFailed: number;
  entityJobsTotal: number;
  exportedTopicCount: number;
  expansionActive: number;
  expansionCompleted: number;
  expansionFailed: number;
  expansionRunCount: number;
  needsReviewTopicCount: number;
  processingActive: number;
  processingFailed: number;
  processedDocumentCount: number;
  publishedRelationCount: number;
  relationReviewReady: number;
  relationVerificationActive: number;
  relationVerificationFailed: number;
  topicCount: number;
};

export type BundleWorkflowSnapshot = {
  active: boolean;
  fingerprint: string;
  nextAction: { detail: string; href: string; label: string } | null;
  stages: BundleWorkflowStage[];
};

export async function getBundleWorkflowSnapshot(input: {
  bundleId: string;
  context: AuthWorkspaceContext;
}): Promise<BundleWorkflowSnapshot> {
  const bundle = await getKnowledgeBundle({ bundleId: input.bundleId, context: input.context });
  if (!bundle) throw new Error("knowledge_bundle_not_found");
  if (!isProductionBackend()) {
    return buildBundleWorkflowSnapshot({
      bundleId: bundle.id,
      facts: emptyFacts(bundle.documentCount),
    });
  }

  const db = getPrisma();
  const [documents, topics, bulkRuns, entityJobs, entityCount, expansionRuns, relationCandidates, assistantAnswerCount] = await Promise.all([
    db.document.findMany({
      select: {
        extractionJobs: { orderBy: { queuedAt: "desc" }, select: { status: true }, take: 1 },
        id: true,
        knowledgeAuthoringRuns: { orderBy: { updatedAt: "desc" }, select: { status: true }, take: 1 },
        topicDiscoveryJobs: { orderBy: { queuedAt: "desc" }, select: { status: true }, take: 1 },
      },
      where: { deletedAt: null, knowledgeBundleId: bundle.id, workspaceId: input.context.workspaceId },
    }),
    db.topicRecord.findMany({
      select: { documentId: true, exportedFilePath: true, reviewStatus: true },
      where: { knowledgeBundleId: bundle.id, workspaceId: input.context.workspaceId },
    }),
    db.bulkTopicApprovalRun.findMany({
      orderBy: { updatedAt: "desc" },
      select: { status: true },
      take: 1,
      where: { knowledgeBundleId: bundle.id, workspaceId: input.context.workspaceId },
    }),
    db.entityExtractionJob.findMany({
      select: { status: true },
      where: { knowledgeBundleId: bundle.id, workspaceId: input.context.workspaceId },
    }),
    db.entityOccurrence.groupBy({
      by: ["entityId"],
      where: { knowledgeBundleId: bundle.id, workspaceId: input.context.workspaceId },
    }).then((rows) => rows.length),
    db.entityExpansionRun.findMany({
      orderBy: { updatedAt: "desc" },
      select: { status: true },
      take: 1,
      where: { knowledgeBundleId: bundle.id, workspaceId: input.context.workspaceId },
    }),
    db.okfRelationCandidate.findMany({
      select: { status: true, verificationStatus: true },
      where: { knowledgeBundleId: bundle.id, workspaceId: input.context.workspaceId },
    }),
    db.chatMessage.count({
      where: {
        knowledgeBundleIds: { has: bundle.id },
        role: "assistant",
        workspaceId: input.context.workspaceId,
      },
    }),
  ]);

  const processedDocumentIds = new Set(topics.map((topic) => topic.documentId));
  const processingStatuses = documents.map((document) =>
    document.knowledgeAuthoringRuns[0]?.status ??
    document.topicDiscoveryJobs[0]?.status ??
    document.extractionJobs[0]?.status ??
    "not_started",
  );
  const facts: BundleWorkflowFacts = {
    approvedTopicCount: topics.filter((topic) => topic.reviewStatus === "approved").length,
    assistantAnswerCount,
    bulkApprovalActive: bulkRuns.filter((run) => ["queued", "running"].includes(run.status)).length,
    bulkApprovalFailed: bulkRuns.filter((run) => ["failed", "completed_with_failures"].includes(run.status)).length,
    documentCount: documents.length,
    entityCount,
    entityJobsActive: entityJobs.filter((job) => ["queued", "running"].includes(job.status)).length,
    entityJobsCompleted: entityJobs.filter((job) => job.status === "completed").length,
    entityJobsFailed: entityJobs.filter((job) => job.status === "failed").length,
    entityJobsTotal: entityJobs.length,
    exportedTopicCount: topics.filter((topic) => topic.reviewStatus === "approved" && topic.exportedFilePath).length,
    expansionActive: expansionRuns.filter((run) => ["queued", "running"].includes(run.status)).length,
    expansionCompleted: expansionRuns.filter((run) => ["completed", "completed_with_warnings"].includes(run.status)).length,
    expansionFailed: expansionRuns.filter((run) => run.status === "failed").length,
    expansionRunCount: expansionRuns.length,
    needsReviewTopicCount: topics.filter((topic) => topic.reviewStatus === "needs_review").length,
    processingActive: processingStatuses.filter((status) => ["queued", "running", "analyzing", "consolidating"].includes(status)).length,
    processingFailed: processingStatuses.filter((status) => ["failed", "blocked"].includes(status)).length,
    processedDocumentCount: processedDocumentIds.size,
    publishedRelationCount: relationCandidates.filter((candidate) => candidate.status === "approved").length,
    relationReviewReady: relationCandidates.filter((candidate) => candidate.status === "pending" && candidate.verificationStatus === "confirmed").length,
    relationVerificationActive: relationCandidates.filter((candidate) => candidate.status === "pending" && ["queued", "running"].includes(candidate.verificationStatus)).length,
    relationVerificationFailed: relationCandidates.filter((candidate) => candidate.status === "pending" && candidate.verificationStatus === "failed").length,
    topicCount: topics.length,
  };
  return buildBundleWorkflowSnapshot({ bundleId: bundle.id, facts });
}

export function buildBundleWorkflowSnapshot(input: {
  bundleId: string;
  facts: BundleWorkflowFacts;
}): BundleWorkflowSnapshot {
  const { facts } = input;
  const encodedBundleId = encodeURIComponent(input.bundleId);
  const documentsHref = `/documents?scope=bundle&knowledgeBundleId=${encodedBundleId}`;
  const reviewHref = `/knowledge/${encodedBundleId}/review`;
  const relationsHref = `/knowledge/${encodedBundleId}/relations`;
  const graphHref = `/knowledge/${encodedBundleId}/graph?mode=entities`;
  const browseHref = `/knowledge/${encodedBundleId}/browse`;

  const stages: BundleWorkflowStage[] = [
    {
      actionHref: documentsHref,
      actionLabel: facts.documentCount > 0 ? "View documents" : "Add documents",
      detail: facts.documentCount > 0
        ? `${facts.documentCount} ${facts.documentCount === 1 ? "document is" : "documents are"} assigned to this bundle.`
        : "Add a source document to begin building knowledge.",
      id: "documents",
      status: facts.documentCount > 0 ? "completed" : "action_required",
      title: "Add documents",
    },
    buildProcessingStage(facts, documentsHref),
    buildPublicationStage(facts, reviewHref, browseHref),
    buildEntityStage(facts, graphHref),
    buildConnectionStage(facts, relationsHref),
    buildRelationReviewStage(facts, relationsHref),
    {
      actionHref: "/chat",
      actionLabel: facts.assistantAnswerCount > 0 ? "Continue in Chat" : "Test in Chat",
      detail: facts.exportedTopicCount === 0
        ? "Published knowledge is required before testing retrieval."
        : facts.assistantAnswerCount > 0
          ? `${facts.assistantAnswerCount} assistant ${facts.assistantAnswerCount === 1 ? "answer has" : "answers have"} used this bundle.`
          : "Ask direct and paraphrased questions and verify the cited concepts.",
      id: "chat",
      status: facts.exportedTopicCount === 0 ? "waiting" : facts.assistantAnswerCount > 0 ? "completed" : "action_required",
      title: "Test knowledge in Chat",
    },
  ];
  const nextStage = stages.find((stage) => ["failed", "action_required", "completed_with_warnings"].includes(stage.status)) ??
    stages.find((stage) => stage.status === "running");
  const nextAction = nextStage?.actionHref && nextStage.actionLabel
    ? { detail: nextStage.detail, href: nextStage.actionHref, label: nextStage.actionLabel }
    : null;
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ facts, stages: stages.map(({ id, status, detail }) => ({ id, status, detail })) }))
    .digest("hex");
  return {
    active: stages.some((stage) => stage.status === "running"),
    fingerprint,
    nextAction,
    stages,
  };
}

function buildProcessingStage(facts: BundleWorkflowFacts, href: string): BundleWorkflowStage {
  if (facts.documentCount === 0) return stage("processing", "Process documents", "waiting", "Waiting for a document.", href, "Open documents");
  if (facts.processingActive > 0) return stage("processing", "Process documents", "running", `${facts.processingActive} ${facts.processingActive === 1 ? "document is" : "documents are"} processing.`, href, "Monitor processing");
  if (facts.processingFailed > 0 && facts.processedDocumentCount === 0) return stage("processing", "Process documents", "failed", `${facts.processingFailed} ${facts.processingFailed === 1 ? "document needs" : "documents need"} processing attention.`, href, "Resolve processing");
  if (facts.processedDocumentCount > 0) {
    const status = facts.processingFailed > 0 ? "completed_with_warnings" : "completed";
    return stage("processing", "Process documents", status, `${facts.processedDocumentCount} of ${facts.documentCount} documents produced topic candidates${facts.processingFailed > 0 ? `; ${facts.processingFailed} need attention` : ""}.`, href, "View processing");
  }
  return stage("processing", "Process documents", "action_required", "Documents are present but topic processing has not completed.", href, "Start or resume processing");
}

function buildPublicationStage(facts: BundleWorkflowFacts, reviewHref: string, browseHref: string): BundleWorkflowStage {
  if (facts.topicCount === 0) return stage("publication", "Review and publish topics", "waiting", "Waiting for topic candidates.", reviewHref, "Open review");
  if (facts.bulkApprovalActive > 0) return stage("publication", "Review and publish topics", "running", "A topic approval and export batch is running.", reviewHref, "Monitor batch");
  if (facts.needsReviewTopicCount > 0) return stage("publication", "Review and publish topics", "action_required", `${facts.needsReviewTopicCount} ${facts.needsReviewTopicCount === 1 ? "topic is" : "topics are"} ready for review.`, reviewHref, "Review topics");
  if (facts.exportedTopicCount > 0) {
    const warnings = facts.bulkApprovalFailed > 0 || facts.exportedTopicCount < facts.approvedTopicCount;
    const unpublishedApprovedCount = Math.max(0, facts.approvedTopicCount - facts.exportedTopicCount);
    const warningDetail = [
      unpublishedApprovedCount > 0 ? `${unpublishedApprovedCount} approved ${unpublishedApprovedCount === 1 ? "topic has" : "topics have"} not been exported` : null,
      facts.bulkApprovalFailed > 0 ? `${facts.bulkApprovalFailed} batch ${facts.bulkApprovalFailed === 1 ? "item needs" : "items need"} attention` : null,
    ].filter(Boolean).join("; ");
    return stage(
      "publication",
      "Review and publish topics",
      warnings ? "completed_with_warnings" : "completed",
      `${facts.exportedTopicCount} approved ${facts.exportedTopicCount === 1 ? "topic is" : "topics are"} exported to OKF${warningDetail ? `; ${warningDetail}` : ""}.`,
      warnings ? reviewHref : browseHref,
      warnings ? "Resolve publication warnings" : "View concepts",
    );
  }
  return stage("publication", "Review and publish topics", facts.bulkApprovalFailed > 0 ? "failed" : "action_required", facts.bulkApprovalFailed > 0 ? "The latest publication batch needs attention." : "Topic candidates exist but none have been published.", reviewHref, facts.bulkApprovalFailed > 0 ? "Retry publication" : "Review topics");
}

function buildEntityStage(facts: BundleWorkflowFacts, href: string): BundleWorkflowStage {
  if (facts.exportedTopicCount === 0) return stage("entities", "Extract entities", "waiting", "Waiting for published concepts.", href, "View entity map");
  if (facts.entityJobsActive > 0) return stage("entities", "Extract entities", "running", `${facts.entityJobsActive} entity extraction ${facts.entityJobsActive === 1 ? "job is" : "jobs are"} running.`, href, "Monitor entities");
  if (facts.entityJobsFailed > 0 && facts.entityJobsCompleted === 0) return stage("entities", "Extract entities", "failed", `${facts.entityJobsFailed} entity extraction ${facts.entityJobsFailed === 1 ? "job needs" : "jobs need"} attention.`, href, "Inspect entity failures");
  if (facts.entityJobsCompleted > 0) return stage("entities", "Extract entities", facts.entityJobsFailed > 0 ? "completed_with_warnings" : "completed", `${facts.entityCount} canonical or provisional ${facts.entityCount === 1 ? "entity is" : "entities are"} mapped from ${facts.entityJobsCompleted} completed jobs.`, href, "View entity map");
  return stage("entities", "Extract entities", "action_required", "Published topics have not produced entity extraction jobs yet.", href, "Inspect entity map");
}

function buildConnectionStage(facts: BundleWorkflowFacts, href: string): BundleWorkflowStage {
  if (facts.entityCount === 0) return stage("connections", "Expand relationships", "waiting", "Waiting for grounded entities.", href, "Open relations");
  if (facts.expansionActive > 0 || facts.relationVerificationActive > 0) return stage("connections", "Expand relationships", "running", `${facts.expansionActive + facts.relationVerificationActive} connection ${facts.expansionActive + facts.relationVerificationActive === 1 ? "operation is" : "operations are"} running.`, href, "Monitor expansion");
  if (facts.expansionFailed > 0 && facts.expansionCompleted === 0) return stage("connections", "Expand relationships", "failed", "The latest entity connection expansion needs attention.", href, "Retry expansion");
  if (facts.expansionRunCount > 0) return stage("connections", "Expand relationships", facts.expansionFailed > 0 || facts.relationVerificationFailed > 0 ? "completed_with_warnings" : "completed", `${facts.relationReviewReady} verified ${facts.relationReviewReady === 1 ? "connection is" : "connections are"} ready for review.`, href, "View expansion results");
  return stage("connections", "Expand relationships", "action_required", "Entities are available for a bounded connection expansion run.", href, "Run connection expansion");
}

function buildRelationReviewStage(facts: BundleWorkflowFacts, href: string): BundleWorkflowStage {
  if (facts.expansionRunCount === 0) return stage("relation_review", "Review connection results", "waiting", "Waiting for connection expansion.", href, "Open relations");
  if (facts.relationVerificationActive > 0) return stage("relation_review", "Review connection results", "running", `${facts.relationVerificationActive} connection ${facts.relationVerificationActive === 1 ? "is" : "are"} being verified.`, href, "Monitor verification");
  if (facts.relationReviewReady > 0) return stage("relation_review", "Review connection results", "action_required", `${facts.relationReviewReady} verified ${facts.relationReviewReady === 1 ? "connection requires" : "connections require"} review.`, href, "Review connections");
  if (facts.relationVerificationFailed > 0) return stage("relation_review", "Review connection results", "completed_with_warnings", `${facts.relationVerificationFailed} connection verification ${facts.relationVerificationFailed === 1 ? "failure remains" : "failures remain"} retryable.`, href, "Inspect failures");
  return stage("relation_review", "Review connection results", "completed", facts.publishedRelationCount > 0 ? `${facts.publishedRelationCount} approved ${facts.publishedRelationCount === 1 ? "relation is" : "relations are"} published.` : "No verified connection currently requires review.", href, "View relations");
}

function stage(id: BundleWorkflowStage["id"], title: string, status: BundleWorkflowStatus, detail: string, actionHref: string, actionLabel: string): BundleWorkflowStage {
  return { actionHref, actionLabel, detail, id, status, title };
}

function emptyFacts(documentCount: number): BundleWorkflowFacts {
  return {
    approvedTopicCount: 0,
    assistantAnswerCount: 0,
    bulkApprovalActive: 0,
    bulkApprovalFailed: 0,
    documentCount,
    entityCount: 0,
    entityJobsActive: 0,
    entityJobsCompleted: 0,
    entityJobsFailed: 0,
    entityJobsTotal: 0,
    exportedTopicCount: 0,
    expansionActive: 0,
    expansionCompleted: 0,
    expansionFailed: 0,
    expansionRunCount: 0,
    needsReviewTopicCount: 0,
    processingActive: 0,
    processingFailed: 0,
    processedDocumentCount: 0,
    publishedRelationCount: 0,
    relationReviewReady: 0,
    relationVerificationActive: 0,
    relationVerificationFailed: 0,
    topicCount: 0,
  };
}

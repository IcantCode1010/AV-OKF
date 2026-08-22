import {
  getDocumentById,
  getTopicRecordsByDocumentId,
  updateTopicExportedFilePath,
  updateTopicRelations,
} from "./document-backend.ts";
import { readOkfBundleFile } from "./okf-bundle.ts";
import { exportApprovedTopicForDocument } from "./okf-export-service.ts";
import { getFrontmatterScalar, parseOkfMarkdown } from "./okf-frontmatter.ts";
import {
  getKnowledgeBundleByIdentity,
  resolveKnowledgeBundleRoot,
} from "./knowledge-bundles.ts";
import {
  loadOkfRelationPreflightContext,
  preflightOkfRelationCandidate,
} from "./okf-relation-preflight.ts";
import { loadOkfRelationVerifierContext } from "./okf-relation-evidence-context.ts";
import { normalizeTopicRelations } from "./okf-relation-types.ts";
import { applyPublishedRelationReview } from "./okf-relation-stabilization.ts";
import { retryOkfRelationVerification } from "./okf-relation-verification.ts";
import {
  formatVerifiedRelationReason,
  OKF_RELATION_VERIFIER_VERSION,
  validateRelationVerifierDecision,
} from "./okf-relation-verifier.ts";
import { validateTopicRelations } from "./okf-relations.ts";
import { getPrisma } from "./prisma.ts";

export const AUTOMATIC_RELATION_MIN_CONFIDENCE = 0.95;
export const AUTOMATIC_RELATION_PUBLISHING_ENABLED =
  process.env.AV_OKF_RELATION_AUTO_PUBLISH_ENABLED === "true";
const AUTOMATIC_POLICY_FAILURES = new Set([
  "knowledge_bundle_not_found",
  "relation_competing_supersedes",
  "relation_cycle_detected",
  "relation_exact_duplicate",
  "relation_reason_required",
  "relation_reverse_direction_conflict",
  "relation_reverse_duplicate",
  "relation_self_link",
  "relation_source_missing",
  "relation_source_topic_not_found",
  "relation_target_invalid",
  "relation_target_missing",
  "relation_target_type_mismatch",
  "relation_type_not_allowed",
  "relation_verification_required",
]);

export function getAutomaticRelationApprovalBlocker(input: {
  automaticApprovalRequested: boolean;
  verificationConfidence: number | null;
  verificationDirection: string | null;
  verificationEvidenceQuote: string | null;
  verificationRationale: string | null;
  verificationRelation: string | null;
  verificationStatus: string;
}, options: { publishingEnabled?: boolean } = {}): string | null {
  if (!(options.publishingEnabled ?? AUTOMATIC_RELATION_PUBLISHING_ENABLED)) {
    return "automatic_relation_publishing_suspended";
  }
  if (!input.automaticApprovalRequested) return "automatic_relation_not_requested";
  if (input.verificationStatus !== "confirmed") return "automatic_relation_not_confirmed";
  if (!input.verificationRelation) return "relation_verification_required";
  if ((input.verificationConfidence ?? 0) < AUTOMATIC_RELATION_MIN_CONFIDENCE) {
    return "automatic_relation_confidence_below_threshold";
  }
  if (
    !input.verificationDirection ||
    !input.verificationEvidenceQuote ||
    !input.verificationRationale ||
    !input.verificationRelation
  ) {
    return "relation_verification_required";
  }
  return null;
}

export async function approveVerifiedRelationCandidate(input: {
  actorId: string;
  candidateId: string;
  mode: "automated" | "human";
  workspaceId: string;
}) {
  const prisma = getPrisma();
  const candidate = await prisma.okfRelationCandidate.findFirst({
    where: {
      id: input.candidateId,
      status: { in: ["pending", "approving"] },
      verificationStatus: "confirmed",
      workspaceId: input.workspaceId,
    },
  });
  if (!candidate) throw new Error("relation_candidate_not_found");

  if (input.mode === "automated") {
    const blocker = getAutomaticRelationApprovalBlocker(candidate);
    if (blocker) throw new Error(blocker);
  }

  if (candidate.status === "pending") {
    const claim = await prisma.okfRelationCandidate.updateMany({
      data: { automaticApprovalError: null, status: "approving" },
      where: { id: candidate.id, status: "pending", verificationStatus: "confirmed" },
    });
    if (claim.count !== 1) throw new Error("relation_candidate_already_processing");
  }

  try {
    const bundle = await getKnowledgeBundleByIdentity({
      bundleId: candidate.knowledgeBundleId,
      workspaceId: input.workspaceId,
    });
    if (!bundle || bundle.status !== "active") throw new Error("knowledge_bundle_not_found");
    if (candidate.verifierVersion !== OKF_RELATION_VERIFIER_VERSION) {
      await prisma.okfRelationCandidate.update({ data: { status: "pending" }, where: { id: candidate.id } });
      await retryOkfRelationVerification({ candidateId: candidate.id, workspaceId: input.workspaceId });
      return { bundleId: bundle.id, status: "reverification_queued" as const };
    }
    if (
      !candidate.verificationRelation ||
      !candidate.verificationDirection ||
      !candidate.verificationEvidenceQuote ||
      !candidate.verificationRationale
    ) {
      throw new Error("relation_verification_required");
    }
    if (!bundle.profile.relations.includes(candidate.verificationRelation)) {
      throw new Error("relation_type_not_allowed");
    }

    const verifierContext = await loadOkfRelationVerifierContext({ candidate });
    const { root, source: originalSource, target: originalTarget } = verifierContext;
    if (
      originalSource.contentHash !== candidate.sourceContentHash ||
      originalTarget.contentHash !== candidate.targetContentHash
    ) {
      await prisma.okfRelationCandidate.update({
        data: { status: "pending" },
        where: { id: candidate.id },
      });
      await retryOkfRelationVerification({
        candidateId: candidate.id,
        workspaceId: input.workspaceId,
      });
      return { bundleId: bundle.id, status: "reverification_queued" as const };
    }

    validateRelationVerifierDecision({
      allowedRelations: bundle.profile.relations,
      decision: {
        confidence: candidate.verificationConfidence,
        direction: candidate.verificationDirection,
        evidenceQuote: candidate.verificationEvidenceQuote,
        rationale: candidate.verificationRationale,
        related: true,
        relation: candidate.verificationRelation,
      },
      proposedSource: originalSource,
      proposedTarget: originalTarget,
      requireTargetIdentification: candidate.evidenceChunkIds.length > 0,
      targetAnchors: verifierContext.targetAnchors,
    });

    const reverseDirection = candidate.verificationDirection === "reverse";
    const sourceFile = reverseDirection ? candidate.targetFile : candidate.sourceFile;
    const targetFile = reverseDirection ? candidate.sourceFile : candidate.targetFile;
    const verifiedReason = formatVerifiedRelationReason({
      evidenceQuote: candidate.verificationEvidenceQuote,
      rationale: candidate.verificationRationale,
    });
    const sourceTopic = await prisma.topicRecord.findFirst({
      where: {
        exportedFilePath: sourceFile,
        knowledgeBundleId: bundle.id,
        reviewStatus: "approved",
        workspaceId: input.workspaceId,
      },
    });
    if (!sourceTopic) throw new Error("relation_source_topic_not_found");
    const target = await readOkfBundleFile(root, targetFile);
    const targetType = getFrontmatterScalar(parseOkfMarkdown(target.content).frontmatter, "type");
    if (!targetType) throw new Error("relation_target_type_mismatch");

    const currentRelations = normalizeTopicRelations(sourceTopic.relations);
    const alreadyPublished = currentRelations.some((relation) =>
      relation.relation === candidate.verificationRelation &&
      relation.target === targetFile
    );
    if (!alreadyPublished) {
      const graphContext = await loadOkfRelationPreflightContext({
        excludeCandidateId: candidate.id,
        knowledgeBundleId: bundle.id,
        workspaceId: input.workspaceId,
      });
      const targetDefinition = graphContext.activeFiles.find((file) => file.filePath === targetFile);
      const preflight = preflightOkfRelationCandidate({
        ...graphContext,
        candidate: {
          reason: verifiedReason,
          relation: candidate.verificationRelation,
          sourceFile,
          targetFile,
          targetType: targetDefinition?.type ?? null,
        },
      });
      if (!preflight.accepted) {
        throw new Error(
          preflight.issues.find((issue) => issue.severity === "error")?.code ??
            "relation_preflight_failed",
        );
      }

      const relations = [...currentRelations, {
        approvalMode: input.mode,
        reason: verifiedReason,
        relation: candidate.verificationRelation,
        target: targetFile,
        targetType,
        verificationConfidence: candidate.verificationConfidence,
      }];
      await validateTopicRelations(relations, root);
      await updateTopicRelations(sourceTopic.id, relations);
      const document = await getDocumentById(sourceTopic.documentId);
      if (!document) throw new Error("document_not_found");
      const topics = await getTopicRecordsByDocumentId(document.id);
      const exported = await exportApprovedTopicForDocument({
        document,
        topicId: sourceTopic.id,
        topics,
      });
      await updateTopicExportedFilePath(sourceTopic.id, exported.filename);
    }

    const reviewedAt = new Date();
    await prisma.okfRelationCandidate.update({
      data: {
        automaticApprovalError: null,
        publishedRelation: candidate.verificationRelation,
        publishedReason: verifiedReason,
        publishedSourceFile: sourceFile,
        publishedTargetFile: targetFile,
        reason: verifiedReason,
        reviewedAt,
        reviewedBy: input.mode === "automated" ? `automation:${input.actorId}` : input.actorId,
        status: "approved",
      },
      where: { id: candidate.id },
    });
    await prisma.entityRelationCandidate.updateMany({
      data: { status: "published" },
      where: { projectedCandidateId: candidate.id },
    });
    return { bundleId: bundle.id, status: "approved" as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : "relation_approval_failed";
    await prisma.okfRelationCandidate.updateMany({
      data: { automaticApprovalError: input.mode === "automated" ? message : null, status: "pending" },
      where: { id: candidate.id, status: "approving" },
    });
    throw error;
  }
}

export async function reviewPublishedRelationCandidate(input: {
  actorId: string;
  candidateId: string;
  decision: "reapprove" | "reject";
  workspaceId: string;
}) {
  const prisma = getPrisma();
  const candidate = await prisma.okfRelationCandidate.findFirst({
    where: {
      id: input.candidateId,
      publishedReviewStatus: "ready",
      status: "approved",
      workspaceId: input.workspaceId,
    },
  });
  if (
    !candidate ||
    !candidate.publishedSourceFile ||
    !candidate.publishedTargetFile ||
    !candidate.publishedRelation
  ) {
    throw new Error("published_relation_review_not_found");
  }

  const bundle = await getKnowledgeBundleByIdentity({
    bundleId: candidate.knowledgeBundleId,
    workspaceId: input.workspaceId,
  });
  if (!bundle || bundle.status !== "active") throw new Error("knowledge_bundle_not_found");
  const sourceTopic = await prisma.topicRecord.findFirst({
    where: {
      exportedFilePath: candidate.publishedSourceFile,
      knowledgeBundleId: bundle.id,
      reviewStatus: "approved",
      workspaceId: input.workspaceId,
    },
  });
  if (!sourceTopic) throw new Error("relation_source_topic_not_found");

  let nextRelations = normalizeTopicRelations(sourceTopic.relations);
  let nextReason = candidate.publishedReason ?? candidate.reason;
  if (input.decision === "reapprove") {
    if (
      candidate.verificationStatus !== "confirmed" ||
      !candidate.verificationEvidenceQuote ||
      !candidate.verificationRationale ||
      candidate.verificationRelation !== candidate.publishedRelation
    ) {
      throw new Error("published_relation_reverification_required");
    }
    const verifierContext = await loadOkfRelationVerifierContext({ candidate });
    const { source: originalSource, target: originalTarget } = verifierContext;
    if (originalSource.contentHash !== candidate.sourceContentHash || originalTarget.contentHash !== candidate.targetContentHash) {
      throw new Error("relation_verification_stale_content");
    }
    validateRelationVerifierDecision({
      allowedRelations: [candidate.publishedRelation],
      decision: {
        confidence: candidate.verificationConfidence,
        direction: candidate.publishedSourceFile === candidate.sourceFile ? "proposed" : "reverse",
        evidenceQuote: candidate.verificationEvidenceQuote,
        rationale: candidate.verificationRationale,
        related: true,
        relation: candidate.verificationRelation,
      },
      proposedSource: originalSource,
      proposedTarget: originalTarget,
      requireTargetIdentification: candidate.evidenceChunkIds.length > 0,
      targetAnchors: verifierContext.targetAnchors,
    });
    nextReason = formatVerifiedRelationReason({
      evidenceQuote: candidate.verificationEvidenceQuote,
      rationale: candidate.verificationRationale,
    });
  }

  nextRelations = applyPublishedRelationReview({
    confidence: candidate.verificationConfidence,
    decision: input.decision,
    nextReason,
    publishedRelation: candidate.publishedRelation,
    publishedTargetFile: candidate.publishedTargetFile,
    relations: nextRelations,
  });

  const root = resolveKnowledgeBundleRoot({ bundleId: bundle.id, workspaceId: input.workspaceId });
  await validateTopicRelations(nextRelations, root);
  await updateTopicRelations(sourceTopic.id, nextRelations);
  const document = await getDocumentById(sourceTopic.documentId);
  if (!document) throw new Error("document_not_found");
  const topics = await getTopicRecordsByDocumentId(document.id);
  const exported = await exportApprovedTopicForDocument({ document, topicId: sourceTopic.id, topics });
  await updateTopicExportedFilePath(sourceTopic.id, exported.filename);

  await prisma.okfRelationCandidate.update({
    data: {
      publishedReason: input.decision === "reapprove" ? nextReason : candidate.publishedReason,
      publishedReviewStatus: null,
      reason: input.decision === "reapprove" ? nextReason : candidate.reason,
      reviewedAt: new Date(),
      reviewedBy: input.actorId,
      status: input.decision === "reject" ? "rejected" : "approved",
    },
    where: { id: candidate.id },
  });
  await prisma.entityRelationCandidate.updateMany({
    data: { status: input.decision === "reject" ? "rejected" : "published" },
    where: { projectedCandidateId: candidate.id },
  });
  return { bundleId: bundle.id, status: input.decision === "reject" ? "rejected" as const : "reapproved" as const };
}

export async function attemptAutomaticRelationApproval(candidateId: string) {
  const prisma = getPrisma();
  const candidate = await prisma.okfRelationCandidate.findUnique({ where: { id: candidateId } });
  if (!candidate || candidate.status === "approved") return null;
  const blocker = getAutomaticRelationApprovalBlocker(candidate);
  if (blocker) {
    if (blocker === "automatic_relation_publishing_suspended") {
      await prisma.okfRelationCandidate.update({
        data: {
          automaticApprovalError: blocker,
          automaticApprovalRequested: false,
        },
        where: { id: candidate.id },
      });
      return { error: blocker, status: "human_review_required" as const };
    }
    if (blocker === "automatic_relation_confidence_below_threshold") {
      await prisma.okfRelationCandidate.update({
        data: { automaticApprovalError: blocker, verificationStatus: "filtered" },
        where: { id: candidate.id },
      });
    }
    return { error: blocker, status: "filtered" as const };
  }

  try {
    return await approveVerifiedRelationCandidate({
      actorId: candidate.automaticApprovalActor ?? "unknown",
      candidateId: candidate.id,
      mode: "automated",
      workspaceId: candidate.workspaceId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "relation_approval_failed";
    if (AUTOMATIC_POLICY_FAILURES.has(message)) {
      await prisma.okfRelationCandidate.update({
        data: { automaticApprovalError: message, verificationStatus: "filtered" },
        where: { id: candidate.id },
      });
      return { error: message, status: "filtered" as const };
    }
    return { error: message, status: "failed" as const };
  }
}

export async function reconcileAutomaticRelationApprovals() {
  const prisma = getPrisma();
  await prisma.okfRelationCandidate.updateMany({
    data: { status: "pending" },
    where: { automaticApprovalRequested: true, reviewedAt: null, status: "approving" },
  });
  const candidates = await prisma.okfRelationCandidate.findMany({
    orderBy: { createdAt: "asc" },
    where: {
      automaticApprovalRequested: true,
      status: "pending",
      verificationStatus: "confirmed",
    },
  });
  for (const candidate of candidates) {
    await attemptAutomaticRelationApproval(candidate.id);
  }
  return candidates.length;
}

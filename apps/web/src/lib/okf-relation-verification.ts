import { getFrontmatterScalar, parseOkfMarkdown } from "./okf-frontmatter.ts";
import { getKnowledgeBundleByIdentity, resolveKnowledgeBundleRoot } from "./knowledge-bundles.ts";
import { readOkfBundleFile } from "./okf-bundle.ts";
import { loadOkfRelationPreflightContext, preflightOkfRelationCandidate } from "./okf-relation-preflight.ts";
import {
  buildRelationVerifierConcept,
  OKF_RELATION_VERIFIER_VERSION,
  OkfRelationVerifierError,
  verifyOkfRelationCandidate,
} from "./okf-relation-verifier.ts";
import { getPrisma } from "./prisma.ts";
import {
  getOkfRelationVerificationQueue,
  type OkfRelationVerificationJobPayload,
  type OkfRelationVerificationQueue,
} from "./okf-relation-verification-queue.ts";

const MAX_ATTEMPTS = 3;
const TERMINAL_FILTER_CODES = new Set([
  "relation_verification_direction_mismatch",
  "relation_verification_evidence_not_in_source",
  "relation_verification_incomplete_positive",
  "relation_verification_relation_not_allowed",
]);

export async function runOkfRelationVerificationJob(
  payload: OkfRelationVerificationJobPayload,
  options: { attemptNumber?: number; verify?: typeof verifyOkfRelationCandidate } = {},
) {
  const prisma = getPrisma();
  const candidate = await prisma.okfRelationCandidate.findFirst({
    where: {
      id: payload.candidateId,
      knowledgeBundleId: payload.knowledgeBundleId,
      status: "pending",
      workspaceId: payload.workspaceId,
    },
  });
  if (!candidate || !["queued", "running"].includes(candidate.verificationStatus)) return null;
  await prisma.okfRelationCandidate.update({
    data: { verificationError: null, verificationStatus: "running" },
    where: { id: candidate.id },
  });
  await refreshRelationDiscoveryRun(candidate.discoveryRunId);

  let promptSent = JSON.stringify({ candidateId: candidate.id, status: "provider_not_called" });
  try {
    const bundle = await getKnowledgeBundleByIdentity({
      bundleId: candidate.knowledgeBundleId,
      workspaceId: candidate.workspaceId,
    });
    if (!bundle || bundle.status !== "active") throw new Error("knowledge_bundle_not_found");
    const context = await loadOkfRelationPreflightContext({
      excludeCandidateId: candidate.id,
      knowledgeBundleId: bundle.id,
      workspaceId: candidate.workspaceId,
    });
    const sourceType = context.activeFiles.find((file) => file.filePath === candidate.sourceFile)?.type;
    const targetType = context.activeFiles.find((file) => file.filePath === candidate.targetFile)?.type;
    if (!sourceType || !targetType) throw new Error("relation_verification_concept_inactive");
    const root = resolveKnowledgeBundleRoot({ bundleId: bundle.id, workspaceId: candidate.workspaceId });
    const [source, target] = await Promise.all([
      loadVerifierConcept(root, candidate.sourceFile),
      loadVerifierConcept(root, candidate.targetFile),
    ]);
    const result = await (options.verify ?? verifyOkfRelationCandidate)({
      allowedRelations: bundle.profile.relations,
      forcedDirection: normalizeDirection(candidate.requestedDirection),
      proposedRelation: candidate.relation,
      proposedSource: source,
      proposedTarget: target,
      signals: normalizeSignals(candidate.signals),
      workspaceId: candidate.workspaceId,
    });
    promptSent = result.promptSent;
    const decision = result.decision;
    if (!decision.related) {
      await prisma.$transaction([
        prisma.okfRelationCandidate.update({
          data: {
            sourceContentHash: result.sourceContentHash,
            targetContentHash: result.targetContentHash,
            verificationConfidence: decision.confidence,
            verificationDirection: null,
            verificationError: null,
            verificationEvidenceQuote: null,
            verificationModel: result.model,
            verificationProvider: result.provider,
            verificationRationale: decision.rationale,
            verificationRelation: null,
            verificationStatus: "filtered",
            verifiedAt: new Date(),
            verifierVersion: OKF_RELATION_VERIFIER_VERSION,
          },
          where: { id: candidate.id },
        }),
        prisma.okfRelationVerificationAttempt.create({
          data: {
            candidateId: candidate.id,
            model: result.model,
            promptSent: result.promptSent,
            provider: result.provider,
            rawResponse: result.rawResponse,
            result: decision,
            succeeded: true,
          },
        }),
      ]);
      await refreshRelationDiscoveryRun(candidate.discoveryRunId);
      return { status: "filtered" as const };
    }
    const sourceFile = decision.direction === "reverse" ? candidate.targetFile : candidate.sourceFile;
    const targetFile = decision.direction === "reverse" ? candidate.sourceFile : candidate.targetFile;
    const preflight = preflightOkfRelationCandidate({
      ...context,
      candidate: {
        reason: decision.rationale,
        relation: decision.relation!,
        sourceFile,
        targetFile,
        targetType: context.activeFiles.find((file) => file.filePath === targetFile)?.type ?? null,
      },
    });
    if (!preflight.accepted) throw new Error(preflight.issues.find((issue) => issue.severity === "error")?.code ?? "relation_preflight_failed");
    await prisma.$transaction([
      prisma.okfRelationCandidate.update({
        data: {
          sourceContentHash: result.sourceContentHash,
          targetContentHash: result.targetContentHash,
          verificationConfidence: decision.confidence,
          verificationDirection: decision.direction,
          verificationError: null,
          verificationEvidenceQuote: decision.evidenceQuote,
          verificationModel: result.model,
          verificationProvider: result.provider,
          verificationRationale: decision.rationale,
          verificationRelation: decision.relation,
          verificationStatus: "confirmed",
          verifiedAt: new Date(),
          verifierVersion: OKF_RELATION_VERIFIER_VERSION,
        },
        where: { id: candidate.id },
      }),
      prisma.okfRelationVerificationAttempt.create({
        data: {
          candidateId: candidate.id,
          model: result.model,
          promptSent: result.promptSent,
          provider: result.provider,
          rawResponse: result.rawResponse,
          result: decision,
          succeeded: true,
        },
      }),
    ]);
    await refreshRelationDiscoveryRun(candidate.discoveryRunId);
    return { status: "confirmed" as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : "relation_verification_failed";
    const verifierError = error instanceof OkfRelationVerifierError ? error : null;
    const filtered = TERMINAL_FILTER_CODES.has(message);
    const terminal = filtered || message === "relation_verification_requires_api_key" || (options.attemptNumber ?? 1) >= MAX_ATTEMPTS;
    await prisma.$transaction([
      prisma.okfRelationCandidate.update({
        data: {
          verificationError: message,
          verificationModel: verifierError?.audit.model,
          verificationProvider: verifierError?.audit.provider,
          verificationStatus: filtered ? "filtered" : terminal ? "failed" : "queued",
        },
        where: { id: candidate.id },
      }),
      prisma.okfRelationVerificationAttempt.create({
        data: {
          candidateId: candidate.id,
          errorMessage: message,
          model: verifierError?.audit.model,
          promptSent: verifierError?.audit.promptSent ?? promptSent,
          provider: verifierError?.audit.provider,
          rawResponse: verifierError?.audit.rawResponse,
          succeeded: false,
        },
      }),
    ]);
    await refreshRelationDiscoveryRun(candidate.discoveryRunId);
    if (!terminal) throw error;
    return { error: message, status: filtered ? "filtered" as const : "failed" as const };
  }
}

export async function retryOkfRelationVerification(input: {
  candidateId: string;
  requestedDirection?: "proposed" | "reverse" | null;
  workspaceId: string;
}) {
  const candidate = await getPrisma().okfRelationCandidate.findFirst({
    where: { id: input.candidateId, status: "pending", workspaceId: input.workspaceId },
  });
  if (!candidate) throw new Error("relation_candidate_not_found");
  await getPrisma().okfRelationCandidate.update({
    data: {
      requestedDirection: input.requestedDirection ?? candidate.requestedDirection,
      verificationConfidence: null,
      verificationDirection: null,
      verificationError: null,
      verificationEvidenceQuote: null,
      verificationRationale: null,
      verificationRelation: null,
      verificationStatus: "queued",
      verifiedAt: null,
    },
    where: { id: candidate.id },
  });
  await getOkfRelationVerificationQueue().enqueue({
    candidateId: candidate.id,
    knowledgeBundleId: candidate.knowledgeBundleId,
    workspaceId: candidate.workspaceId,
  });
  await refreshRelationDiscoveryRun(candidate.discoveryRunId);
}

export async function reconcileOkfRelationVerificationJobs(
  queue: OkfRelationVerificationQueue = getOkfRelationVerificationQueue(),
) {
  const candidates = await getPrisma().okfRelationCandidate.findMany({
    orderBy: { createdAt: "asc" },
    where: { status: "pending", verificationStatus: { in: ["queued", "running"] } },
  });
  for (const candidate of candidates) {
    if (candidate.verificationStatus === "running") {
      await getPrisma().okfRelationCandidate.update({ data: { verificationStatus: "queued" }, where: { id: candidate.id } });
    }
    await queue.enqueue({ candidateId: candidate.id, knowledgeBundleId: candidate.knowledgeBundleId, workspaceId: candidate.workspaceId });
  }
  return candidates.length;
}

export async function refreshRelationDiscoveryRun(runId: string | null) {
  if (!runId) return;
  const grouped = await getPrisma().okfRelationCandidate.groupBy({
    _count: { _all: true },
    by: ["verificationStatus"],
    where: { discoveryRunId: runId, status: "pending" },
  });
  const count = (status: string) => grouped.find((group) => group.verificationStatus === status)?._count._all ?? 0;
  const queuedCount = count("queued");
  const runningCount = count("running");
  await getPrisma().okfRelationDiscoveryRun.update({
    data: {
      completedAt: queuedCount + runningCount === 0 ? new Date() : null,
      confirmedCount: count("confirmed"),
      failedCount: count("failed"),
      filteredCount: count("filtered"),
      queuedCount,
      runningCount,
      status: queuedCount + runningCount === 0 ? "completed" : "running",
    },
    where: { id: runId },
  }).catch(() => undefined);
}

async function loadVerifierConcept(root: string, filePath: string) {
  const file = await readOkfBundleFile(root, filePath);
  const parsed = parseOkfMarkdown(file.content);
  return buildRelationVerifierConcept({
    body: parsed.body,
    description: getFrontmatterScalar(parsed.frontmatter, "description"),
    filePath,
    title: getFrontmatterScalar(parsed.frontmatter, "title"),
  });
}

function normalizeSignals(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeDirection(value: string | null): "proposed" | "reverse" | null {
  return value === "proposed" || value === "reverse" ? value : null;
}

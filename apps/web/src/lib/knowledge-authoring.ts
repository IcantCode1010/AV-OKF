import { generateText, Output } from "ai";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import type { AuthWorkspaceContext } from "./auth-workspace.ts";
import { enrichTopic } from "./topic-enrichment.ts";
import { getWorkspaceLlmApiKeyForEnrichment } from "./llm-provider-settings.ts";
import { getLlmProvider, getSdkModel, type LlmProviderId } from "./llm-providers.ts";
import {
  buildDeterministicRelationCandidates,
  tokenizeRelationTerms,
  type RelationDiscoveryCandidate,
} from "./okf-relation-discovery.ts";
import {
  loadOkfRelationPreflightContext,
  preflightOkfRelationCandidate,
  relationPreflightSignal,
} from "./okf-relation-preflight.ts";
import { getPrisma } from "./prisma.ts";
import { createPostgresDocumentRepository } from "./production-repository.ts";
import { estimateTokens } from "./topic-discovery.ts";
import { createBullMqTopicDiscoveryQueue } from "./topic-discovery-queue.ts";
import type { KnowledgeAuthoringJobPayload } from "./knowledge-authoring-queue.ts";
import { getKnowledgeBundleByIdentity } from "./knowledge-bundles.ts";
import {
  buildRelationVerifierConcept,
  verifyOkfRelationCandidate,
} from "./okf-relation-verifier.ts";
import { getOkfRelationVerificationQueue } from "./okf-relation-verification-queue.ts";
import { discoverDocumentRelationCandidates } from "./okf-document-relation-candidates.ts";
import { createRagRepository } from "./rag-repository.ts";
import { createBullMqRagIndexQueue } from "./rag-queue.ts";
import { getDefaultChunkingStrategyId } from "./rag-reindex.ts";
import {
  loadApprovedTopicMediaForEnrichment,
  runDocumentMediaDiscovery,
} from "./topic-media-discovery.ts";

export const AUTHORING_STAGES = [
  "metadata_discovery",
  "concept_discovery",
  "media_discovery",
  "full_rag_index",
  "enrichment",
  "relation_classification",
  "validation",
] as const;

export const KNOWLEDGE_AUTHORING_OPERATIONS = [
  "propose_metadata",
  "discover_concepts",
  "discover_topic_media",
  "enrich_concepts",
  "classify_relations",
  "validate_review_package",
] as const;

export const AUTHORING_INPUT_TOKEN_CONFIRMATION_THRESHOLD = 250_000;
export const AUTHORING_CONCEPT_CONFIRMATION_THRESHOLD = 25;

const metadataSchema = z.object({
  classificationCode: z.string().nullable(),
  description: z.string(),
  documentType: z.string().nullable(),
  effectivity: z.string().nullable(),
  rationale: z.array(z.object({
    field: z.string(),
    reason: z.string(),
  })),
  revision: z.string().nullable(),
  sourceAuthority: z.string().nullable(),
  subjectFamily: z.string().nullable(),
  tags: z.array(z.string()),
  title: z.string(),
});

export type MetadataProposal = z.infer<typeof metadataSchema>;

export type AuthoringValidationResult = {
  errors: string[];
  topicId: string;
  valid: boolean;
};

export function requiresAuthoringCostConfirmation(input: {
  conceptCount: number;
  estimatedInputTokens: number;
}) {
  return input.conceptCount > AUTHORING_CONCEPT_CONFIRMATION_THRESHOLD ||
    input.estimatedInputTokens > AUTHORING_INPUT_TOKEN_CONFIRMATION_THRESHOLD;
}

export function normalizeMetadataProposal(input: MetadataProposal) {
  const cleanNullable = (value: string | null) => value?.trim() || null;
  return {
    classificationCode: cleanNullable(input.classificationCode),
    description: input.description.trim(),
    documentType: cleanNullable(input.documentType),
    effectivity: cleanNullable(input.effectivity),
    revision: cleanNullable(input.revision),
    sourceAuthority: cleanNullable(input.sourceAuthority),
    subjectFamily: cleanNullable(input.subjectFamily),
    tags: [...new Set(input.tags.map((tag) => tag.trim()).filter(Boolean))],
    title: input.title.trim(),
  };
}

export function validateAuthoringTopics(topics: Array<{
  enrichmentStatus: string;
  id: string;
  proposedSourcePageNumbers: number[];
  sourcePageNumbers: number[];
  summary: string;
  title: string;
}>) : AuthoringValidationResult[] {
  return topics.map((topic) => {
    const errors: string[] = [];
    if (!topic.title.trim()) errors.push("title_required");
    if (!topic.summary.trim()) errors.push("summary_required");
    if (topic.sourcePageNumbers.length === 0) errors.push("source_pages_required");
    if (topic.enrichmentStatus === "failed") errors.push("enrichment_failed");
    if (topic.proposedSourcePageNumbers.length > 0) errors.push("proposed_source_pages_require_review");
    return { errors, topicId: topic.id, valid: errors.length === 0 };
  });
}

export async function runKnowledgeAuthoringJob(payload: KnowledgeAuthoringJobPayload) {
  const db = getPrisma();
  const run = await db.knowledgeAuthoringRun.findFirst({
    where: { documentId: payload.documentId, id: payload.runId, workspaceId: payload.workspaceId },
  });
  if (!run) throw new Error("knowledge_authoring_run_not_found");
  if (run.status === "ready_for_review" || run.status === "completed") return run;

  const document = await db.document.findFirst({
    include: { extractedPages: { orderBy: { pageNumber: "asc" } } },
    where: { deletedAt: null, id: payload.documentId, workspaceId: payload.workspaceId },
  });
  if (!document) throw new Error("document_not_found");
  if (!document.knowledgeBundleId || document.knowledgeBundleId !== run.knowledgeBundleId) {
    return db.knowledgeAuthoringRun.update({
      data: { errorCode: "document_unassigned", errorMessage: "The document is no longer assigned to this knowledge bundle.", status: "failed" },
      where: { id: run.id },
    });
  }
  const activeBundle = await getKnowledgeBundleByIdentity({ bundleId: document.knowledgeBundleId, workspaceId: payload.workspaceId });
  if (!activeBundle) {
    return db.knowledgeAuthoringRun.update({ data: { errorCode: "knowledge_bundle_unavailable", status: "failed" }, where: { id: run.id } });
  }

  const key = await getWorkspaceLlmApiKeyForEnrichment(payload.workspaceId);
  if (!key) {
    return db.knowledgeAuthoringRun.update({
      data: { errorCode: "knowledge_authoring_requires_api_key", status: "awaiting_provider" },
      where: { id: run.id },
    });
  }
  const provider = getLlmProvider(key.provider);
  const context: AuthWorkspaceContext = {
    role: "admin",
    userId: run.requestedBy ?? "knowledge-authoring-system",
    workspaceId: run.workspaceId,
  };
  const topicRepository = createPostgresDocumentRepository(db);
  let activeStage = run.currentStage;

  await db.knowledgeAuthoringRun.update({
    data: { errorCode: null, errorMessage: null, startedAt: run.startedAt ?? new Date(), status: "running" },
    where: { id: run.id },
  });

  try {
    if (run.completedStages.length === 0 && !run.costConfirmedAt) {
      const sourceTokens = estimateTokens(document.extractedPages.map((page) => page.text).join("\n"));
      const estimate = {
        discoveryTokens: Math.ceil(sourceTokens * 1.2),
        embeddingTokens: sourceTokens,
        enrichmentTokens: sourceTokens,
      };
      const combinedTokens = Object.values(estimate).reduce((sum, value) => sum + value, 0);
      await db.knowledgeAuthoringRun.update({
        data: { costEstimate: estimate, estimatedInputTokens: combinedTokens },
        where: { id: run.id },
      });
      if (requiresAuthoringCostConfirmation({ conceptCount: 0, estimatedInputTokens: combinedTokens })) {
        return db.knowledgeAuthoringRun.update({
          data: { currentStage: "metadata_discovery", status: "awaiting_cost_confirmation" },
          where: { id: run.id },
        });
      }
    }
    if (!run.completedStages.includes("metadata_discovery")) {
      activeStage = "metadata_discovery";
      await beginStage(run.id, activeStage);
      await runMetadataDiscovery({ apiKey: key.apiKey, document, model: provider.model, provider: key.provider, runId: run.id });
      await completeStage(run.id, "metadata_discovery", "concept_discovery");
    }

    if (!run.completedStages.includes("concept_discovery")) {
      activeStage = "concept_discovery";
      await beginStage(run.id, activeStage);
      await stageAudit(run.id, activeStage, "running", undefined, key.provider, provider.model);
      const existingDiscoveryJobs = await db.topicDiscoveryJob.findMany({
        orderBy: { queuedAt: "asc" },
        select: {
          documentId: true,
          id: true,
          queuedAt: true,
          status: true,
          workspaceId: true,
        },
        where: {
          documentId: document.id,
          queuedAt: { gte: run.createdAt },
          status: { in: ["queued", "analyzing", "consolidating", "completed"] },
          workspaceId: run.workspaceId,
        },
      });
      const discoveryPlan = planAuthoringTopicDiscovery(existingDiscoveryJobs);
      if (discoveryPlan.supersededIds.length > 0) {
        await db.topicDiscoveryJob.updateMany({
          data: {
            completedAt: new Date(),
            errorCode: "topic_discovery_superseded_by_active_job",
            errorMessage: "A single authoring-owned discovery job was retained.",
            status: "failed",
          },
          where: { id: { in: discoveryPlan.supersededIds } },
        });
      }
      const discoveryJob = discoveryPlan.job ?? await db.topicDiscoveryJob.create({
        data: { documentId: document.id, workspaceId: run.workspaceId },
        select: {
          documentId: true,
          id: true,
          queuedAt: true,
          status: true,
          workspaceId: true,
        },
      });
      if (discoveryJob.status !== "completed") {
        const redisUrl = process.env.REDIS_URL;
        if (!redisUrl) throw new Error("missing_env_REDIS_URL");
        await createBullMqTopicDiscoveryQueue(redisUrl).enqueue({
          documentId: discoveryJob.documentId,
          topicDiscoveryJobId: discoveryJob.id,
          workspaceId: discoveryJob.workspaceId,
        });
        return db.knowledgeAuthoringRun.update({
          data: { currentStage: "concept_discovery", status: "running" },
          where: { id: run.id },
        });
      }
      await stageAudit(run.id, activeStage, "completed", undefined, key.provider, provider.model);
      await completeStage(run.id, "concept_discovery", "media_discovery");
    }

    if (!run.completedStages.includes("media_discovery")) {
      activeStage = "media_discovery";
      await beginStage(run.id, activeStage);
      await stageAudit(run.id, activeStage, "running", undefined, key.provider, provider.model);
      try {
        const mediaResult = await runDocumentMediaDiscovery({
          documentId: document.id,
          runId: run.id,
          workspaceId: run.workspaceId,
        });
        await stageAudit(
          run.id,
          activeStage,
          "completed",
          mediaResult.warnings.length ? mediaResult.warnings.join("; ") : undefined,
          key.provider,
          provider.model,
          undefined,
          JSON.stringify(mediaResult),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await stageAudit(
          run.id,
          activeStage,
          "completed",
          `non_blocking_media_warning:${message}`,
          key.provider,
          provider.model,
        );
      }
      await completeStage(run.id, "media_discovery", "full_rag_index");
    }

    if (!run.completedStages.includes("full_rag_index")) {
      activeStage = "full_rag_index";
      const currentDocument = await db.document.findUnique({ select: { ragStatus: true }, where: { id: document.id } });
      if (currentDocument?.ragStatus !== "indexed") {
        const existingJob = await db.ragIndexJob.findFirst({
          orderBy: { queuedAt: "desc" },
          where: { documentId: document.id, status: { in: ["queued", "running", "awaiting_budget"] } },
        });
        const indexJob = existingJob ?? await createRagRepository().createIndexJob({
          documentId: document.id,
          extractionJobId: (await db.extractionJob.findFirst({ orderBy: { queuedAt: "desc" }, select: { id: true }, where: { documentId: document.id } }))?.id,
          workspaceId: run.workspaceId,
        });
        if (!existingJob) {
          const redisUrl = process.env.REDIS_URL;
          if (!redisUrl) throw new Error("missing_env_REDIS_URL");
          await createBullMqRagIndexQueue(redisUrl).enqueueIndexJob({
            chunkingStrategyId: getDefaultChunkingStrategyId(),
            documentId: document.id,
            indexJobId: indexJob.id,
            indexVersion: indexJob.indexVersion,
            mode: "initial",
            workspaceId: run.workspaceId,
          });
        }
        return db.knowledgeAuthoringRun.update({ data: { currentStage: "full_rag_index", status: "waiting_for_rag" }, where: { id: run.id } });
      }
      await completeStage(run.id, "full_rag_index", "enrichment");
    }

    const topics = await db.topicRecord.findMany({
      where: { documentId: document.id, reviewStatus: { in: ["needs_review", "needs_cleanup"] }, workspaceId: run.workspaceId },
    });
    const enrichmentTopics = topics.filter((topic) =>
      run.automaticTopicApprovalEnabled
        ? topic.confidence === "high"
        : topic.confidence === "medium" || topic.confidence === "high"
    );
    const estimatedInputTokens = enrichmentTopics.reduce((total, topic) => {
      const source = document.extractedPages
        .filter((page) => topic.sourcePageNumbers.includes(page.pageNumber))
        .map((page) => page.text)
        .join("\n");
      return total + estimateTokens(source);
    }, 0);
    await db.knowledgeAuthoringRun.update({
      data: { enrichmentCandidateCount: enrichmentTopics.length, estimatedInputTokens },
      where: { id: run.id },
    });
    if (!run.completedStages.includes("enrichment")) {
      activeStage = "enrichment";
      await beginStage(run.id, activeStage);
      await stageAudit(run.id, "enrichment", "running", undefined, key.provider, provider.model);
      for (const topic of enrichmentTopics) {
        const media = activeBundle.profile.media.topicFiguresEnabled
          ? await loadApprovedTopicMediaForEnrichment({
              topicId: topic.id,
              workspaceId: run.workspaceId,
            })
          : [];
        await enrichTopic(topic.id, {
          context,
          media,
          sourcePageMode: run.automaticTopicApprovalEnabled ? "exact" : "expanded",
          repository: {
            approveTopicContent: topicRepository.approveTopicContent,
            completeTopicEnrichment: topicRepository.completeTopicEnrichment,
            failTopicEnrichment: topicRepository.failTopicEnrichment,
            getTopicEnrichmentInput: topicRepository.getTopicEnrichmentInput,
            markTopicEnrichmentPending: topicRepository.markTopicEnrichmentPending,
          },
        });
      }
      await stageAudit(run.id, "enrichment", "completed", undefined, key.provider, provider.model);
      await completeStage(run.id, "enrichment", "relation_classification");
    }

    if (!run.completedStages.includes("relation_classification")) {
      activeStage = "relation_classification";
      await beginStage(run.id, activeStage);
      await classifyDraftRelations({ apiKey: key.apiKey, documentId: document.id, knowledgeBundleId: document.knowledgeBundleId, model: provider.model, provider: key.provider, runId: run.id, workspaceId: run.workspaceId });
      await completeStage(run.id, "relation_classification", "validation");
    }

    activeStage = "validation";
    await beginStage(run.id, activeStage);
    await stageAudit(run.id, activeStage, "running");
    const currentTopics = await db.topicRecord.findMany({
      where: { documentId: document.id, reviewStatus: { in: ["needs_review", "needs_cleanup"] }, workspaceId: run.workspaceId },
    });
    const validationResults = validateAuthoringTopics(currentTopics);
    await stageAudit(run.id, activeStage, "completed");
    return db.knowledgeAuthoringRun.update({
      data: {
        completedStages: { push: "validation" },
        currentStage: "review",
        readyAt: new Date(),
        status: "ready_for_review",
        validationResults,
      },
      where: { id: run.id },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await stageAudit(run.id, activeStage, "failed", message);
    await db.knowledgeAuthoringRun.update({
      data: { errorCode: message, errorMessage: message, status: "failed" },
      where: { id: run.id },
    });
    throw error;
  }
}

export function planAuthoringTopicDiscovery<T extends {
  id: string;
  queuedAt: Date;
  status: string;
}>(jobs: T[]): { job: T | null; supersededIds: string[] } {
  const ordered = [...jobs].sort(
    (left, right) => left.queuedAt.getTime() - right.queuedAt.getTime() ||
      left.id.localeCompare(right.id),
  );
  const completed = ordered.filter((job) => job.status === "completed").at(-1);
  const active = ordered.filter((job) =>
    ["queued", "analyzing", "consolidating"].includes(job.status)
  );
  const job = completed ?? active[0] ?? null;
  return {
    job,
    supersededIds: active.filter((candidate) => candidate.id !== job?.id).map(({ id }) => id),
  };
}

async function runMetadataDiscovery(input: {
  apiKey: string;
  document: { classificationCode: string | null; description: string; documentType: string | null; effectivity: string | null; extractedPages: Array<{ pageNumber: number; text: string }>; id: string; revision: string | null; sourceAuthority: string | null; subjectFamily: string | null; tags: string[]; title: string; workspaceId: string };
  model: string;
  provider: LlmProviderId;
  runId: string;
}) {
  const prompt = [
    "Analyze this document and propose concise, general-purpose metadata.",
    "Use only the supplied text. Preserve exact identifiers and do not invent authority, revision, classification, or applicability.",
    "Return title, description, tags, subjectFamily, documentType, classificationCode, effectivity, sourceAuthority, revision, and a rationale array of {field, reason} entries.",
    `Current title: ${input.document.title}`,
    input.document.extractedPages.slice(0, 12).map((page) => `Page ${page.pageNumber}\n${page.text}`).join("\n\n"),
  ].join("\n\n");
  await stageAudit(input.runId, "metadata_discovery", "running", undefined, input.provider, input.model, prompt);
  const result = await generateText({
    model: getSdkModel(input.provider, input.apiKey),
    output: Output.object({ schema: metadataSchema }),
    prompt,
  });
  const proposal = metadataSchema.parse(result.output);
  const applied = normalizeMetadataProposal(proposal);
  if (!applied.title) throw new Error("metadata_discovery_invalid_title");
  const previous = {
    classificationCode: input.document.classificationCode,
    description: input.document.description,
    documentType: input.document.documentType,
    effectivity: input.document.effectivity,
    revision: input.document.revision,
    sourceAuthority: input.document.sourceAuthority,
    subjectFamily: input.document.subjectFamily,
    tags: input.document.tags,
    title: input.document.title,
  };
  const db = getPrisma();
  await db.$transaction([
    db.document.update({ data: applied, where: { id: input.document.id } }),
    db.documentMetadataProposal.create({
      data: { appliedValues: applied, documentId: input.document.id, model: input.model, previousValues: previous, proposedValues: proposal, provider: input.provider, rationale: proposal.rationale, runId: input.runId, workspaceId: input.document.workspaceId },
    }),
  ]);
  await stageAudit(input.runId, "metadata_discovery", "completed", undefined, input.provider, input.model, prompt, JSON.stringify(proposal));
}

async function classifyDraftRelations(input: { apiKey: string; documentId: string; knowledgeBundleId: string; model: string; provider: LlmProviderId; runId: string; workspaceId: string }) {
  const db = getPrisma();
  const bundle = await getKnowledgeBundleByIdentity({
    bundleId: input.knowledgeBundleId,
    workspaceId: input.workspaceId,
  });
  if (!bundle) throw new Error("knowledge_bundle_not_found");
  const topics = await db.topicRecord.findMany({
    orderBy: [{ pageStart: "asc" }, { id: "asc" }],
    where: {
      documentId: input.documentId,
      knowledgeBundleId: input.knowledgeBundleId,
      reviewStatus: { in: ["needs_review", "needs_cleanup"] },
      workspaceId: input.workspaceId,
    },
  });
  const concepts = topics.map((topic) => ({
    filePath: `topic:${topic.id}`,
    pages: topic.sourcePageNumbers,
    sourceFile: topic.documentId,
    tags: getRelationTopicTags(topic.okfMetadata),
    terms: tokenizeRelationTerms(`${topic.title} ${topic.summary}`),
  }));
  const deterministicCandidates = buildDeterministicRelationCandidates(concepts, {
    stopwords: bundle.profile.relationDiscovery.stopwords,
  });
  let modelCandidateError: string | null = null;
  const modelCandidates = await discoverDocumentRelationCandidates({
    allowedRelations: bundle.profile.relations,
    apiKey: input.apiKey,
    concepts: topics.map((topic) => ({
      body: topic.enrichedBody ?? topic.summary,
      description: topic.enrichedSummary ?? topic.summary,
      filePath: `topic:${topic.id}`,
      title: topic.enrichedTitle ?? topic.title,
      type: topic.topicType,
    })),
    model: input.model,
    provider: input.provider,
  }).catch((error) => {
    modelCandidateError = error instanceof Error
      ? error.message
      : "document_relation_candidate_generation_failed";
    return [];
  });
  const candidates = mergeAuthoringRelationCandidates(
    deterministicCandidates,
    modelCandidates,
  ).slice(0, 50);
  if (candidates.length === 0) {
    await stageAudit(input.runId, "relation_classification", "completed");
    return;
  }
  const allowed = bundle.profile.relations;
  const topicByReference = new Map(topics.map((topic) => [`topic:${topic.id}`, topic]));
  const accepted: Array<Record<string, unknown>> = [];
  const auditResults: Array<Record<string, unknown>> = modelCandidateError
    ? [{ stage: "document_local_candidate_generation", error: modelCandidateError }]
    : [];
  await stageAudit(input.runId, "relation_classification", "running", undefined, input.provider, input.model, JSON.stringify({ candidateCount: candidates.length }));
  for (const candidate of candidates) {
    const sourceTopic = topicByReference.get(candidate.sourceFile);
    const targetTopic = topicByReference.get(candidate.targetFile);
    if (!sourceTopic || !targetTopic) continue;
    const source = buildRelationVerifierConcept({
      body: sourceTopic.enrichedBody ?? sourceTopic.summary,
      description: sourceTopic.enrichedSummary ?? sourceTopic.summary,
      filePath: candidate.sourceFile,
      title: sourceTopic.enrichedTitle ?? sourceTopic.title,
    });
    const target = buildRelationVerifierConcept({
      body: targetTopic.enrichedBody ?? targetTopic.summary,
      description: targetTopic.enrichedSummary ?? targetTopic.summary,
      filePath: candidate.targetFile,
      title: targetTopic.enrichedTitle ?? targetTopic.title,
    });
    try {
      const verification = await verifyOkfRelationCandidate({
        allowedRelations: allowed,
        proposedRelation: candidate.relation,
        proposedSource: source,
        proposedTarget: target,
        signals: candidate.signals,
        workspaceId: input.workspaceId,
      }, {
        getApiKey: async () => ({ apiKey: input.apiKey, provider: input.provider }),
      });
      auditResults.push({ candidate, decision: verification.decision });
      if (!verification.decision.related) continue;
      accepted.push({
        confidence: verification.decision.confidence,
        direction: verification.decision.direction,
        evidenceQuote: verification.decision.evidenceQuote,
        knowledgeBundleId: input.knowledgeBundleId,
        rationale: verification.decision.rationale,
        reason: verification.decision.rationale,
        relation: verification.decision.relation!,
        signals: candidate.signals,
        sourceContentHash: verification.sourceContentHash,
        sourceFile: candidate.sourceFile,
        targetContentHash: verification.targetContentHash,
        targetFile: candidate.targetFile,
        workspaceId: input.workspaceId,
      });
    } catch (error) {
      auditResults.push({ candidate, error: error instanceof Error ? error.message : "relation_verification_failed" });
    }
  }
  await db.knowledgeAuthoringRun.update({
    data: { relationSuggestions: accepted as unknown as Prisma.InputJsonValue },
    where: { id: input.runId },
  });
  await stageAudit(input.runId, "relation_classification", "completed", undefined, input.provider, input.model, JSON.stringify({ candidateCount: candidates.length }), JSON.stringify(auditResults));
}

function mergeAuthoringRelationCandidates(
  deterministic: RelationDiscoveryCandidate[],
  model: RelationDiscoveryCandidate[],
) {
  const merged = new Map<string, RelationDiscoveryCandidate>();
  for (const candidate of [...deterministic, ...model]) {
    const key = `${candidate.sourceFile}\u0000${candidate.targetFile}\u0000${candidate.relation}`;
    const current = merged.get(key);
    merged.set(key, current
      ? {
          ...current,
          signals: [...new Set([...current.signals, ...candidate.signals])],
        }
      : candidate);
  }
  return [...merged.values()].sort((left, right) =>
    Number(right.signals.includes("llm_document_local_candidate")) -
      Number(left.signals.includes("llm_document_local_candidate")) ||
    left.sourceFile.localeCompare(right.sourceFile) ||
    left.targetFile.localeCompare(right.targetFile) ||
    left.relation.localeCompare(right.relation),
  );
}

async function completeStage(runId: string, stage: string, nextStage: string) {
  await getPrisma().knowledgeAuthoringRun.update({
    data: { completedStages: { push: stage }, currentStage: nextStage },
    where: { id: runId },
  });
}

async function beginStage(runId: string, stage: string) {
  await getPrisma().knowledgeAuthoringRun.update({
    data: { currentStage: stage },
    where: { id: runId },
  });
}

async function stageAudit(runId: string, stage: string, status: string, errorMessage?: string, provider?: string, model?: string, promptSent?: string, rawResponse?: string) {
  const db = getPrisma();
  const latestRunning = status === "running" ? null : await db.knowledgeAuthoringStageAudit.findFirst({
    orderBy: { createdAt: "desc" },
    where: { runId, stage, status: "running" },
  });
  const attempt = latestRunning?.attempt ?? ((await db.knowledgeAuthoringStageAudit.count({
    where: { runId, stage, status: "running" },
  })) + 1);
  await db.knowledgeAuthoringStageAudit.create({
    data: { attempt, completedAt: status === "running" ? null : new Date(), errorMessage, model, promptSent, provider, rawResponse, runId, stage, status },
  });
}

export async function confirmKnowledgeAuthoringCost(input: { context: AuthWorkspaceContext; runId: string }) {
  const db = getPrisma();
  const run = await db.knowledgeAuthoringRun.findFirst({ where: { id: input.runId, workspaceId: input.context.workspaceId } });
  if (!run) throw new Error("knowledge_authoring_workspace_mismatch");
  if (run.status !== "awaiting_cost_confirmation") throw new Error("knowledge_authoring_not_awaiting_cost_confirmation");
  return db.knowledgeAuthoringRun.update({ data: { costConfirmedAt: new Date(), costConfirmedBy: input.context.userId, status: "queued" }, where: { id: run.id } });
}

export async function createKnowledgeAuthoringRun(input: { context: AuthWorkspaceContext; documentId: string }) {
  const db = getPrisma();
  const document = await db.document.findFirst({
    where: { deletedAt: null, id: input.documentId, workspaceId: input.context.workspaceId },
  });
  if (!document) throw new Error("knowledge_authoring_workspace_mismatch");
  if (document.status !== "ready") throw new Error("knowledge_authoring_requires_extracted_document");
  if (!document.knowledgeBundleId) throw new Error("document_requires_active_knowledge_bundle");
  const bundle = await getKnowledgeBundleByIdentity({
    bundleId: document.knowledgeBundleId,
    workspaceId: input.context.workspaceId,
  });
  if (!bundle) throw new Error("knowledge_bundle_not_found");
  return db.knowledgeAuthoringRun.create({
    data: {
      automaticTopicApprovalEnabled: bundle.profile.automation.autoApproveEnrichedTopics,
      automaticRelationApprovalEnabled:
        bundle.profile.automation.autoApproveVerifiedRelations,
      documentId: document.id,
      knowledgeBundleId: document.knowledgeBundleId,
      profileVersion: bundle.activeProfileVersion,
      requestedBy: input.context.userId,
      workspaceId: input.context.workspaceId,
    },
  });
}

export async function getLatestKnowledgeAuthoringRun(input: { context: AuthWorkspaceContext; documentId: string }) {
  return getPrisma().knowledgeAuthoringRun.findFirst({
    include: {
      automaticApprovalRun: {
        include: {
          items: { select: { status: true } },
        },
      },
      metadataProposals: { orderBy: { createdAt: "desc" }, take: 1 },
      stageAudits: { orderBy: { createdAt: "asc" } },
    },
    orderBy: { createdAt: "desc" },
    where: { documentId: input.documentId, workspaceId: input.context.workspaceId },
  });
}

export async function promoteAuthoringRelationSuggestions(input: { context: AuthWorkspaceContext; runId: string }) {
  const db = getPrisma();
  const run = await db.knowledgeAuthoringRun.findFirst({
    where: { id: input.runId, workspaceId: input.context.workspaceId },
  });
  if (!run) throw new Error("knowledge_authoring_workspace_mismatch");
  if (run.status !== "ready_for_review" && run.status !== "completed") {
    throw new Error("knowledge_authoring_not_ready_for_relation_review");
  }

  const suggestions = normalizeAuthoringRelationSuggestions(run.relationSuggestions);
  const graphContext = await loadOkfRelationPreflightContext({
    knowledgeBundleId: run.knowledgeBundleId,
    workspaceId: run.workspaceId,
  });
  let promoted = 0;
  let skipped = 0;
  for (const suggestion of suggestions) {
    const sourceTopicId = parseTopicReference(suggestion.sourceFile);
    const targetTopicId = parseTopicReference(suggestion.targetFile);
    if (!sourceTopicId || !targetTopicId) {
      skipped += 1;
      continue;
    }
    const [sourceTopic, targetTopic] = await Promise.all([
      db.topicRecord.findFirst({ where: { id: sourceTopicId, knowledgeBundleId: run.knowledgeBundleId, reviewStatus: "approved", workspaceId: run.workspaceId } }),
      db.topicRecord.findFirst({ where: { id: targetTopicId, knowledgeBundleId: run.knowledgeBundleId, reviewStatus: "approved", workspaceId: run.workspaceId } }),
    ]);
    if (!sourceTopic?.exportedFilePath || !targetTopic?.exportedFilePath) {
      skipped += 1;
      continue;
    }
    const candidateKey = {
      knowledgeBundleId_sourceFile_targetFile_relation: {
        knowledgeBundleId: run.knowledgeBundleId,
        relation: suggestion.relation,
        sourceFile: sourceTopic.exportedFilePath,
        targetFile: targetTopic.exportedFilePath,
      },
    };
    const existingCandidate = await db.okfRelationCandidate.findUnique({ where: candidateKey });
    if (existingCandidate && existingCandidate.status !== "pending") {
      skipped += 1;
      continue;
    }
    const proposedCandidate = {
      reason: suggestion.reason,
      relation: suggestion.relation,
      sourceFile: sourceTopic.exportedFilePath,
      targetFile: targetTopic.exportedFilePath,
    };
    const existingEdges = existingCandidate
      ? graphContext.existingEdges.filter((edge) => !(
          edge.relation === proposedCandidate.relation &&
          edge.sourceFile === proposedCandidate.sourceFile &&
          edge.targetFile === proposedCandidate.targetFile
        ))
      : graphContext.existingEdges;
    const preflight = preflightOkfRelationCandidate({
      activeFiles: graphContext.activeFiles,
      allowedRelations: graphContext.allowedRelations,
      candidate: proposedCandidate,
      existingEdges,
    });
    if (!preflight.accepted) {
      skipped += 1;
      continue;
    }
    const signals = [
      ...suggestion.signals,
      ...preflight.issues
        .filter((issue) => issue.severity === "warning")
        .map(relationPreflightSignal),
    ];
    let promotedCandidate;
    if (existingCandidate) {
      promotedCandidate = await db.okfRelationCandidate.update({
        data: {
          authoringRunId: run.id,
          automaticApprovalActor: run.requestedBy,
          automaticApprovalError: null,
          automaticApprovalRequested: run.automaticRelationApprovalEnabled,
          reason: suggestion.reason,
          signals,
          verificationStatus:
            existingCandidate.verificationStatus === "confirmed"
              ? "confirmed"
              : "queued",
        },
        where: candidateKey,
      });
    } else {
      promotedCandidate = await db.okfRelationCandidate.create({
        data: {
          authoringRunId: run.id,
          automaticApprovalActor: run.requestedBy,
          automaticApprovalRequested: run.automaticRelationApprovalEnabled,
          knowledgeBundleId: run.knowledgeBundleId,
          reason: suggestion.reason,
          relation: suggestion.relation,
          signals,
          sourceFile: sourceTopic.exportedFilePath,
          targetFile: targetTopic.exportedFilePath,
          workspaceId: run.workspaceId,
          verificationStatus: "queued",
        },
      });
    }
    if (promotedCandidate.verificationStatus !== "confirmed") {
      await getOkfRelationVerificationQueue().enqueue({
        candidateId: promotedCandidate.id,
        knowledgeBundleId: run.knowledgeBundleId,
        workspaceId: run.workspaceId,
      });
    } else if (promotedCandidate.automaticApprovalRequested) {
      const { attemptAutomaticRelationApproval } = await import(
        "./okf-relation-approval.ts"
      );
      await attemptAutomaticRelationApproval(promotedCandidate.id);
    }
    promoted += 1;
  }
  return { knowledgeBundleId: run.knowledgeBundleId, promoted, skipped };
}

export async function reconcileAutomaticAuthoringRelationsForDocument(input: {
  documentId: string;
  workspaceId: string;
}) {
  const runs = await getPrisma().knowledgeAuthoringRun.findMany({
    orderBy: { createdAt: "asc" },
    where: {
      automaticRelationApprovalEnabled: true,
      documentId: input.documentId,
      status: { in: ["ready_for_review", "completed"] },
      workspaceId: input.workspaceId,
    },
  });
  let promoted = 0;
  let skipped = 0;
  for (const run of runs) {
    const result = await promoteAuthoringRelationSuggestions({
      context: {
        role: "member",
        userId: run.requestedBy ?? "system",
        workspaceId: run.workspaceId,
      },
      runId: run.id,
    });
    promoted += result.promoted;
    skipped += result.skipped;
  }
  return { promoted, skipped };
}

export function normalizeAuthoringRelationSuggestions(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const relation = "relation" in candidate && typeof candidate.relation === "string" ? candidate.relation : "";
    const sourceFile = "sourceFile" in candidate && typeof candidate.sourceFile === "string" ? candidate.sourceFile : "";
    const targetFile = "targetFile" in candidate && typeof candidate.targetFile === "string" ? candidate.targetFile : "";
    const reason = "reason" in candidate && typeof candidate.reason === "string" ? candidate.reason : "";
    const signals = "signals" in candidate && Array.isArray(candidate.signals) ? (candidate.signals as unknown[]).filter((signal): signal is string => typeof signal === "string") : [];
    const evidenceQuote = "evidenceQuote" in candidate && typeof candidate.evidenceQuote === "string" ? candidate.evidenceQuote : "";
    const rationale = "rationale" in candidate && typeof candidate.rationale === "string" ? candidate.rationale : reason;
    return relation && sourceFile && targetFile && reason && evidenceQuote ? [{ evidenceQuote, rationale, reason, relation, signals, sourceFile, targetFile }] : [];
  });
}

export function parseTopicReference(value: string) {
  return value.startsWith("topic:") && value.length > 6 ? value.slice(6) : null;
}

function getRelationTopicTags(value: unknown): string[] {
  if (!value || typeof value !== "object" || !("tags" in value)) return [];
  const tags = (value as { tags?: unknown }).tags;
  return Array.isArray(tags)
    ? tags.filter((tag): tag is string => typeof tag === "string")
    : [];
}

export async function undoAuthoringMetadata(input: { context: AuthWorkspaceContext; proposalId: string }) {
  const db = getPrisma();
  const proposal = await db.documentMetadataProposal.findFirst({ where: { id: input.proposalId, workspaceId: input.context.workspaceId } });
  if (!proposal) throw new Error("metadata_proposal_workspace_mismatch");
  if (proposal.status !== "applied") throw new Error("metadata_proposal_not_applied");
  const previous = proposal.previousValues as Record<string, unknown>;
  await db.$transaction([
    db.document.update({ data: previous, where: { id: proposal.documentId } }),
    db.documentMetadataProposal.update({ data: { status: "undone", undoneAt: new Date(), undoneBy: input.context.userId }, where: { id: proposal.id } }),
  ]);
}

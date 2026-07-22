import { generateText, Output } from "ai";
import { z } from "zod";

import type { AuthWorkspaceContext } from "./auth-workspace.ts";
import { enrichTopic } from "./topic-enrichment.ts";
import { getWorkspaceLlmApiKeyForEnrichment } from "./llm-provider-settings.ts";
import { getLlmProvider, getSdkModel } from "./llm-providers.ts";
import {
  buildDeterministicRelationCandidates,
  tokenizeRelationTerms,
} from "./okf-relation-discovery.ts";
import {
  loadOkfRelationPreflightContext,
  preflightOkfRelationCandidate,
  relationPreflightSignal,
} from "./okf-relation-preflight.ts";
import { getPrisma } from "./prisma.ts";
import { createPostgresDocumentRepository } from "./production-repository.ts";
import { runTopicDiscoveryJob } from "./topic-discovery-service.ts";
import { estimateTokens } from "./topic-discovery.ts";
import type { KnowledgeAuthoringJobPayload } from "./knowledge-authoring-queue.ts";
import { getKnowledgeBundleByIdentity } from "./knowledge-bundles.ts";

export const AUTHORING_STAGES = [
  "metadata_discovery",
  "concept_discovery",
  "enrichment",
  "relation_classification",
  "validation",
] as const;

export const KNOWLEDGE_AUTHORING_OPERATIONS = [
  "propose_metadata",
  "discover_concepts",
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

const relationClassificationSchema = z.object({
  relations: z.array(z.object({
    candidateIndex: z.number().int().nonnegative(),
    reason: z.string(),
    relation: z.string(),
  })),
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
      const discoveryJob = await db.topicDiscoveryJob.create({
        data: { documentId: document.id, workspaceId: run.workspaceId },
      });
      const result = await runTopicDiscoveryJob({
        documentId: document.id,
        topicDiscoveryJobId: discoveryJob.id,
        workspaceId: run.workspaceId,
      });
      if (result.status !== "completed") {
        await stageAudit(run.id, activeStage, "failed", `topic_discovery_${result.status}`, key.provider, provider.model);
        return db.knowledgeAuthoringRun.update({
          data: { currentStage: "concept_discovery", status: result.status },
          where: { id: run.id },
        });
      }
      await stageAudit(run.id, activeStage, "completed", undefined, key.provider, provider.model);
      await completeStage(run.id, "concept_discovery", "enrichment");
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
    if (!run.costConfirmedAt && requiresAuthoringCostConfirmation({ conceptCount: enrichmentTopics.length, estimatedInputTokens })) {
      return db.knowledgeAuthoringRun.update({
        data: { currentStage: "enrichment", status: "awaiting_cost_confirmation" },
        where: { id: run.id },
      });
    }

    if (!run.completedStages.includes("enrichment")) {
      activeStage = "enrichment";
      await beginStage(run.id, activeStage);
      await stageAudit(run.id, "enrichment", "running", undefined, key.provider, provider.model);
      for (const topic of enrichmentTopics) {
        await enrichTopic(topic.id, {
          context,
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

async function runMetadataDiscovery(input: {
  apiKey: string;
  document: { classificationCode: string | null; description: string; documentType: string | null; effectivity: string | null; extractedPages: Array<{ pageNumber: number; text: string }>; id: string; revision: string | null; sourceAuthority: string | null; subjectFamily: string | null; tags: string[]; title: string; workspaceId: string };
  model: string;
  provider: "anthropic" | "openai";
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

async function classifyDraftRelations(input: { apiKey: string; documentId: string; knowledgeBundleId: string; model: string; provider: "anthropic" | "openai"; runId: string; workspaceId: string }) {
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
    sourceFile: input.documentId,
    tags: [],
    terms: tokenizeRelationTerms(`${topic.title} ${topic.summary}`),
  }));
  const candidates = buildDeterministicRelationCandidates(concepts, {
    stopwords: bundle.profile.relationDiscovery.stopwords,
  }).slice(0, 50);
  if (candidates.length === 0) {
    await stageAudit(input.runId, "relation_classification", "completed");
    return;
  }
  const allowed = bundle.profile.relations;
  const prompt = [
    "Classify only the supplied deterministic candidate pairs.",
    `Allowed relation values: ${allowed.join(", ")}.`,
    "Omit candidates that do not have a clear relationship. Do not create new pairs.",
    JSON.stringify(candidates.map((candidate, candidateIndex) => ({ candidateIndex, ...candidate }))),
  ].join("\n\n");
  await stageAudit(input.runId, "relation_classification", "running", undefined, input.provider, input.model, prompt);
  const result = await generateText({
    model: getSdkModel(input.provider, input.apiKey),
    output: Output.object({ schema: relationClassificationSchema }),
    prompt,
  });
  const output = relationClassificationSchema.parse(result.output);
  const accepted = output.relations.flatMap((classification) => {
    const candidate = candidates[classification.candidateIndex];
    if (!candidate || !allowed.includes(classification.relation)) return [];
    return [{
      knowledgeBundleId: input.knowledgeBundleId,
      reason: classification.reason.trim() || candidate.reason,
      relation: classification.relation,
      signals: candidate.signals,
      sourceFile: candidate.sourceFile,
      targetFile: candidate.targetFile,
      workspaceId: input.workspaceId,
    }];
  });
  await db.knowledgeAuthoringRun.update({
    data: { relationSuggestions: accepted },
    where: { id: input.runId },
  });
  await stageAudit(input.runId, "relation_classification", "completed", undefined, input.provider, input.model, prompt, JSON.stringify(output));
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
    if (existingCandidate) {
      await db.okfRelationCandidate.update({
        data: { reason: suggestion.reason, signals },
        where: candidateKey,
      });
    } else {
      await db.okfRelationCandidate.create({
        data: {
          knowledgeBundleId: run.knowledgeBundleId,
          reason: suggestion.reason,
          relation: suggestion.relation,
          signals,
          sourceFile: sourceTopic.exportedFilePath,
          targetFile: targetTopic.exportedFilePath,
          workspaceId: run.workspaceId,
        },
      });
      graphContext.existingEdges.push(proposedCandidate);
    }
    promoted += 1;
  }
  return { knowledgeBundleId: run.knowledgeBundleId, promoted, skipped };
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
    return relation && sourceFile && targetFile && reason ? [{ reason, relation, signals, sourceFile, targetFile }] : [];
  });
}

export function parseTopicReference(value: string) {
  return value.startsWith("topic:") && value.length > 6 ? value.slice(6) : null;
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

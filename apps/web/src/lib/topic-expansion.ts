import { createHash } from "node:crypto";

import { generateText, Output } from "ai";
import { z } from "zod";

import type { AuthWorkspaceContext } from "./auth-workspace.ts";
import { getWorkspaceLlmApiKeyForEnrichment } from "./llm-provider-settings.ts";
import { getLlmProvider, getSdkModel } from "./llm-providers.ts";
import { readOkfBundleFile } from "./okf-bundle.ts";
import { parseOkfMarkdown } from "./okf-frontmatter.ts";
import { getKnowledgeBundleByIdentity, resolveKnowledgeBundleRoot } from "./knowledge-bundles.ts";
import type { OperationProgressSnapshot, OperationProgressStatus } from "./operation-progress.ts";
import { getPrisma } from "./prisma.ts";
import { retrieveDocuments } from "./rag-backend.ts";
import { rerankRawRagCandidates } from "./rag-reranker.ts";
import { estimateTokens } from "./topic-discovery.ts";
import { enrichTopic } from "./topic-enrichment.ts";
import type { TopicExpansionJobPayload } from "./topic-expansion-queue.ts";
import {
  MAX_TOPIC_RESEARCH_ROUNDS,
  runBoundedTopicResearch,
  topicResearchAnalysisSchema,
  topicResearchPlanSchema,
} from "./topic-expansion-research.ts";

export const MAX_TOPIC_EXPANSION_PROPOSALS = 10;
export const TOPIC_EXPANSION_INPUT_TOKEN_LIMIT = 18_000;
const TOPIC_EXPANSION_PROMPT_VERSION = "approved-okf-topic-research-v2";

const criticSchema = z.object({
  selectedIds: z.array(z.string()).max(MAX_TOPIC_EXPANSION_PROPOSALS),
});

export type ExpansionConcept = {
  approvalMode: string | null;
  body: string;
  contentHash: string;
  documentId: string;
  filePath: string;
  id: string;
  title: string;
  topicType: string;
  trustTier: "automated" | "human" | "legacy";
  chunks: Array<{
    contentHash: string;
    documentId: string;
    id: string;
    pages: number[];
    text: string;
  }>;
  entityNames: string[];
};

export type ValidatedTopicExpansionCandidate = {
  confidence: number;
  evidence: Array<{
    chunkContentHash: string;
    chunkId: string;
    conceptContentHash: string;
    documentId: string;
    evidenceQuote: string;
    sourceFilePath: string;
    sourcePages: number[];
    sourceTopicId: string;
    trustTier: string;
  }>;
  identityFingerprint: string;
  normalizedTitle: string;
  rationale: string;
  summary: string;
  title: string;
  topicType: string;
};

export type TopicExpansionProgressData = {
  completed: number;
  current: { candidateCount: number; completedRounds: number; currentRound: number; evidenceChunkCount: number; heartbeatAt: string | null; id: string; searchQueryCount: number; stage: string; title: string } | null;
  failed: number;
  next: Array<{ id: string; title: string }>;
  queued: number;
  recent: Array<{ candidateCount: number; completedRounds: number; evidenceChunkCount: number; id: string; searchQueryCount: number; stopReason: string | null; title: string }>;
  runId: string;
  status: string;
  total: number;
};

export type TopicExpansionProvider = {
  analyze(input: { prompt: string; system: string }): Promise<unknown>;
  critique(input: { prompt: string; system: string }): Promise<unknown>;
  plan(input: { prompt: string; system: string }): Promise<unknown>;
  model: string;
  provider: string;
};

export async function prepareTopicExpansionRun(input: {
  context: AuthWorkspaceContext;
  knowledgeBundleId: string;
}) {
  const bundle = await requireActiveBundle(input);
  const activeRun = await getPrisma().topicExpansionRun.findFirst({
    orderBy: { createdAt: "desc" },
    where: { knowledgeBundleId: bundle.id, status: { in: ["awaiting_confirmation", "queued", "running"] }, workspaceId: input.context.workspaceId },
  });
  if (activeRun) return activeRun;
  const concepts = await loadExpansionConcepts(input.knowledgeBundleId, input.context.workspaceId);
  if (concepts.length === 0) throw new Error("topic_expansion_requires_approved_concepts");
  const corpusHash = hashCorpus(concepts);
  const existing = await getPrisma().topicExpansionRun.findUnique({
    where: { knowledgeBundleId_corpusHash: { corpusHash, knowledgeBundleId: bundle.id } },
  });
  if (existing?.status === "cancelled") {
    return getPrisma().topicExpansionRun.update({ data: { completedAt: null, errorCode: null, errorMessage: null, status: "awaiting_confirmation" }, where: { id: existing.id } });
  }
  if (existing) return existing;
  const estimatedInputTokens = concepts.length * TOPIC_EXPANSION_INPUT_TOKEN_LIMIT * MAX_TOPIC_RESEARCH_ROUNDS;
  const estimatedCalls = concepts.length * (1 + MAX_TOPIC_RESEARCH_ROUNDS * 2) + 1;
  return getPrisma().topicExpansionRun.create({
    data: {
      approvedConceptCount: concepts.length,
      corpusHash,
      estimatedCalls,
      estimatedInputTokens,
      knowledgeBundleId: bundle.id,
      requestedBy: input.context.userId,
      workspaceId: input.context.workspaceId,
    },
  });
}

export async function confirmTopicExpansionRun(input: {
  context: AuthWorkspaceContext;
  enqueue: (payload: { kind: "crawl"; runId: string; workspaceId: string }) => Promise<void>;
  knowledgeBundleId: string;
  runId: string;
}) {
  const run = await getPrisma().topicExpansionRun.findFirst({
    where: { id: input.runId, knowledgeBundleId: input.knowledgeBundleId, workspaceId: input.context.workspaceId },
  });
  if (!run) throw new Error("topic_expansion_run_not_found");
  if (run.status === "awaiting_confirmation") {
    await getPrisma().topicExpansionRun.update({ data: { status: "queued" }, where: { id: run.id } });
  } else if (!["queued", "running", "completed", "completed_with_warnings"].includes(run.status)) {
    throw new Error("topic_expansion_run_not_confirmable");
  }
  if (["queued", "running"].includes(run.status) || run.status === "awaiting_confirmation") {
    await input.enqueue({ kind: "crawl", runId: run.id, workspaceId: run.workspaceId });
  }
  return getPrisma().topicExpansionRun.findUniqueOrThrow({ where: { id: run.id } });
}

export async function runTopicExpansion(
  runId: string,
  options: {
    enqueue?: (payload: TopicExpansionJobPayload) => Promise<void>;
    provider?: TopicExpansionProvider;
  } = {},
) {
  const db = getPrisma();
  const run = await db.topicExpansionRun.findUnique({ where: { id: runId } });
  if (!run) throw new Error("topic_expansion_run_not_found");
  if (run.status === "cancellation_requested") {
    return db.topicExpansionRun.update({ data: { completedAt: new Date(), status: "cancelled" }, where: { id: run.id } });
  }
  // A stale BullMQ job may survive cancellation. Provider work is authorized only
  // after the confirmation action has moved the durable run to queued.
  if (!isTopicExpansionRunExecutable(run.status)) return run;
  if (!await getKnowledgeBundleByIdentity({ bundleId: run.knowledgeBundleId, workspaceId: run.workspaceId })) throw new Error("knowledge_bundle_not_found");
  const concepts = await loadExpansionConcepts(run.knowledgeBundleId, run.workspaceId);
  if (hashCorpus(concepts) !== run.corpusHash) {
    await db.topicExpansionRun.update({ data: { errorCode: "topic_expansion_corpus_changed", status: "failed" }, where: { id: run.id } });
    throw new Error("topic_expansion_corpus_changed");
  }
  let provider: TopicExpansionProvider;
  try {
    provider = options.provider ?? await createDefaultProvider(run.workspaceId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "topic_expansion_requires_api_key") {
      return db.topicExpansionRun.update({ data: { errorCode: message, errorMessage: message, status: "awaiting_provider" }, where: { id: run.id } });
    }
    throw error;
  }
  const enqueue = options.enqueue;
  if (!enqueue) throw new Error("topic_expansion_queue_unavailable");
  const jobs = await db.$transaction(async (tx) => {
    await tx.topicExpansionRun.update({
      data: { attempts: { increment: 1 }, errorCode: null, errorMessage: null, model: provider.model, provider: provider.provider, startedAt: run.startedAt ?? new Date(), status: "running" },
      where: { id: run.id },
    });
    const created = [];
    for (const concept of concepts) {
      created.push(await tx.topicExpansionResearchJob.upsert({
        create: { knowledgeBundleId: run.knowledgeBundleId, runId: run.id, sourceContentHash: concept.contentHash, sourceTopicId: concept.id, workspaceId: run.workspaceId },
        update: {},
        where: { runId_sourceTopicId: { runId: run.id, sourceTopicId: concept.id } },
      }));
    }
    return created;
  });
  for (const job of jobs.filter(({ status }) => status === "queued" || status === "running")) {
    await enqueue({ jobId: job.id, kind: "research", workspaceId: job.workspaceId });
  }
  if (jobs.length === 0) await finalizeTopicExpansionRun(run.id, provider);
  return db.topicExpansionRun.findUniqueOrThrow({ where: { id: run.id } });
}

export async function runTopicExpansionResearchJob(
  jobId: string,
  options: {
    provider?: TopicExpansionProvider;
    rerank?: typeof rerankRawRagCandidates;
    retrieve?: typeof retrieveDocuments;
  } = {},
) {
  const db = getPrisma();
  const job = await db.topicExpansionResearchJob.findUnique({ include: { run: true }, where: { id: jobId } });
  if (!job) throw new Error("topic_expansion_research_job_not_found");
  if (job.status === "completed" || job.status === "cancelled") return job;
  if (job.run.status === "cancellation_requested" || job.run.status === "cancelled") {
    await db.topicExpansionResearchJob.update({ data: { completedAt: new Date(), stage: "cancelled", status: "cancelled" }, where: { id: job.id } });
    await finalizeTopicExpansionRun(job.runId, options.provider);
    return db.topicExpansionResearchJob.findUniqueOrThrow({ where: { id: job.id } });
  }
  const bundle = await getKnowledgeBundleByIdentity({ bundleId: job.knowledgeBundleId, workspaceId: job.workspaceId });
  if (!bundle) throw new Error("knowledge_bundle_not_found");
  const concepts = await loadExpansionConcepts(job.knowledgeBundleId, job.workspaceId);
  const seed = concepts.find(({ id }) => id === job.sourceTopicId);
  if (!seed || seed.contentHash !== job.sourceContentHash) {
    await db.topicExpansionResearchJob.update({ data: { completedAt: new Date(), errorCode: "topic_expansion_source_stale", stage: "failed", status: "failed" }, where: { id: job.id } });
    await finalizeTopicExpansionRun(job.runId, options.provider);
    throw new Error("topic_expansion_source_stale");
  }
  let provider: TopicExpansionProvider;
  try {
    provider = options.provider ?? await createDefaultProvider(job.workspaceId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.topicExpansionResearchJob.update({ data: { errorCode: message, errorMessage: message, stage: "failed", status: "failed" }, where: { id: job.id } });
    await db.topicExpansionRun.update({ data: { errorCode: message, errorMessage: message, status: message === "topic_expansion_requires_api_key" ? "awaiting_provider" : "completed_with_warnings" }, where: { id: job.runId } });
    throw error;
  }
  await db.topicExpansionResearchJob.update({
    data: { attempts: { increment: 1 }, errorCode: null, errorMessage: null, heartbeatAt: new Date(), stage: "planning_retrieval", startedAt: job.startedAt ?? new Date(), status: "running", stopReason: null },
    where: { id: job.id },
  });
  const heartbeat = setInterval(() => {
    void db.topicExpansionResearchJob.updateMany({
      data: { heartbeatAt: new Date() },
      where: { id: job.id, status: "running" },
    }).catch(() => undefined);
  }, 10_000);
  try {
    const result = await runBoundedTopicResearch({
      allowedTypes: Object.keys(bundle.profile.types),
      concepts,
      knowledgeBundleId: job.knowledgeBundleId,
      onProgress: async (progress) => {
        await db.topicExpansionResearchJob.updateMany({
          data: {
            candidateCount: progress.candidateCount,
            completedRounds: progress.completedRounds,
            currentRound: progress.currentRound,
            evidenceChunkCount: progress.evidenceChunkCount,
            heartbeatAt: new Date(),
            searchQueryCount: progress.searchQueryCount,
            stage: progress.stage,
          },
          where: { id: job.id, status: "running" },
        });
      },
      provider,
      rerank: options.rerank ?? rerankRawRagCandidates,
      retrieve: options.retrieve ?? retrieveDocuments,
      seed,
      workspaceId: job.workspaceId,
    });
    const candidates = result.proposals
      .map((proposal) => validateExpansionCandidate({ allowedTypes: Object.keys(bundle.profile.types), concepts, proposal }))
      .filter((candidate): candidate is ValidatedTopicExpansionCandidate => Boolean(candidate));
    await db.topicExpansionResearchJob.update({
      data: {
        candidateCount: candidates.length,
        completedAt: new Date(),
        completedRounds: result.completedRounds,
        evidenceChunkCount: result.evidenceChunkCount,
        output: candidates,
        searchQueryCount: result.searchQueryCount,
        stage: "completed",
        status: "completed",
        stopReason: result.stopReason,
      },
      where: { id: job.id },
    });
    await updateTopicExpansionRunProgress(job.runId);
    await finalizeTopicExpansionRun(job.runId, provider);
    return db.topicExpansionResearchJob.findUniqueOrThrow({ where: { id: job.id } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.topicExpansionResearchJob.update({ data: { completedAt: new Date(), errorCode: message, errorMessage: message, stage: "failed", status: "failed" }, where: { id: job.id } });
    await updateTopicExpansionRunProgress(job.runId);
    await finalizeTopicExpansionRun(job.runId, provider);
    throw error;
  } finally {
    clearInterval(heartbeat);
  }
}

async function updateTopicExpansionRunProgress(runId: string) {
  const jobs = await getPrisma().topicExpansionResearchJob.findMany({ select: { candidateCount: true, status: true }, where: { runId } });
  await getPrisma().topicExpansionRun.update({
    data: {
      analyzedConceptCount: jobs.filter(({ status }) => ["completed", "failed", "cancelled"].includes(status)).length,
      candidateCount: jobs.reduce((sum, job) => sum + job.candidateCount, 0),
    },
    where: { id: runId },
  });
}

async function finalizeTopicExpansionRun(runId: string, suppliedProvider?: TopicExpansionProvider) {
  const db = getPrisma();
  const run = await db.topicExpansionRun.findUnique({ include: { researchJobs: true }, where: { id: runId } });
  if (!run || run.researchJobs.some(({ status }) => ["queued", "running"].includes(status))) return;
  if (run.status === "cancellation_requested") {
    await db.topicExpansionRun.update({ data: { completedAt: new Date(), status: "cancelled" }, where: { id: run.id } });
    return;
  }
  const bundle = await getKnowledgeBundleByIdentity({ bundleId: run.knowledgeBundleId, workspaceId: run.workspaceId });
  if (!bundle) throw new Error("knowledge_bundle_not_found");
  const provider = suppliedProvider ?? await createDefaultProvider(run.workspaceId);
  await db.topicExpansionRun.update({ data: { status: "consolidating" }, where: { id: run.id } });
  const [existingTopics, acceptedAliases, rejected] = await Promise.all([
    db.topicRecord.findMany({ select: { title: true }, where: { knowledgeBundleId: run.knowledgeBundleId, reviewStatus: { not: "rejected" }, workspaceId: run.workspaceId } }),
    db.entityAlias.findMany({ select: { value: true }, where: { entity: { occurrences: { some: { knowledgeBundleId: run.knowledgeBundleId } }, workspaceId: run.workspaceId }, status: "accepted" } }),
    db.topicExpansionProposal.findMany({ select: { identityFingerprint: true }, where: { knowledgeBundleId: run.knowledgeBundleId, status: "rejected", workspaceId: run.workspaceId } }),
  ]);
  const existingTitles = [...existingTopics.map(({ title }) => normalizeTopicTitle(title)), ...acceptedAliases.map(({ value }) => normalizeTopicTitle(value))];
  const rejectedFingerprints = new Set(rejected.map(({ identityFingerprint }) => identityFingerprint));
  const rawCandidates = run.researchJobs.flatMap(({ output }) => parseResearchJobOutput(output));
  const merged = mergeExpansionCandidates(rawCandidates).filter((candidate) =>
    !rejectedFingerprints.has(candidate.identityFingerprint)
    && !isDuplicateTitle(candidate.normalizedTitle, existingTitles));
  const ranked = rankExpansionCandidates(merged);
  const candidateById = new Map(ranked.map((candidate) => [candidate.identityFingerprint, candidate]));
  const critic = ranked.length === 0 ? { selectedIds: [] } : criticSchema.parse(await provider.critique({
    prompt: buildCriticPrompt(ranked),
    system: "Select only supplied candidate IDs. Prefer specific, independently supported missing topics. Do not create, rename, merge, or rewrite candidates.",
  }));
  const selected = [...new Set(critic.selectedIds)]
    .map((id) => candidateById.get(id))
    .filter((candidate): candidate is ValidatedTopicExpansionCandidate => Boolean(candidate))
    .slice(0, MAX_TOPIC_EXPANSION_PROPOSALS);
  await db.$transaction(async (tx) => {
    for (const [index, candidate] of selected.entries()) {
      const primary = selectPrimaryEvidence(candidate.evidence);
      const proposal = await tx.topicExpansionProposal.upsert({
        create: { confidence: candidate.confidence, identityFingerprint: candidate.identityFingerprint, knowledgeBundleId: run.knowledgeBundleId, normalizedTitle: candidate.normalizedTitle, primaryDocumentId: primary.documentId, rank: index + 1, rationale: candidate.rationale, runId: run.id, status: "proposed", summary: candidate.summary, title: candidate.title, topicType: candidate.topicType, workspaceId: run.workspaceId },
        update: { confidence: candidate.confidence, rank: index + 1, rationale: candidate.rationale, summary: candidate.summary },
        where: { knowledgeBundleId_identityFingerprint: { identityFingerprint: candidate.identityFingerprint, knowledgeBundleId: run.knowledgeBundleId } },
      });
      for (const evidence of candidate.evidence) {
        await tx.topicExpansionEvidence.upsert({
          create: { ...evidence, proposalId: proposal.id },
          update: { chunkContentHash: evidence.chunkContentHash, conceptContentHash: evidence.conceptContentHash, sourcePages: evidence.sourcePages, trustTier: evidence.trustTier },
          where: { proposalId_sourceTopicId_chunkId_evidenceQuote: { chunkId: evidence.chunkId, evidenceQuote: evidence.evidenceQuote, proposalId: proposal.id, sourceTopicId: evidence.sourceTopicId } },
        });
      }
    }
    await tx.topicExpansionRun.update({
      data: { analyzedConceptCount: run.researchJobs.length, candidateCount: merged.length, completedAt: new Date(), filteredCount: Math.max(0, merged.length - selected.length), proposedCount: selected.length, status: run.researchJobs.some(({ status }) => status === "failed") ? "completed_with_warnings" : "completed" },
      where: { id: run.id },
    });
  });
}

function parseResearchJobOutput(value: unknown): ValidatedTopicExpansionCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.filter((candidate): candidate is ValidatedTopicExpansionCandidate => {
    if (!candidate || typeof candidate !== "object") return false;
    const item = candidate as Partial<ValidatedTopicExpansionCandidate>;
    return typeof item.identityFingerprint === "string" && typeof item.normalizedTitle === "string" && Array.isArray(item.evidence);
  });
}

export function mergeExpansionCandidates(candidates: ValidatedTopicExpansionCandidate[]) {
  const merged = new Map<string, ValidatedTopicExpansionCandidate>();
  for (const candidate of candidates) {
    const existing = merged.get(candidate.identityFingerprint);
    if (!existing) {
      merged.set(candidate.identityFingerprint, { ...candidate, evidence: dedupeEvidence(candidate.evidence) });
      continue;
    }
    merged.set(candidate.identityFingerprint, {
      ...existing,
      confidence: Math.max(existing.confidence, candidate.confidence),
      evidence: dedupeEvidence([...existing.evidence, ...candidate.evidence]),
      rationale: candidate.rationale.length > existing.rationale.length ? candidate.rationale : existing.rationale,
      summary: candidate.summary.length > existing.summary.length ? candidate.summary : existing.summary,
    });
  }
  return [...merged.values()];
}

export function isTopicExpansionRunExecutable(status: string) {
  return status === "queued" || status === "running";
}

export async function cancelTopicExpansionRun(input: { context: AuthWorkspaceContext; knowledgeBundleId: string; runId: string }) {
  const run = await getPrisma().topicExpansionRun.findFirst({ where: { id: input.runId, knowledgeBundleId: input.knowledgeBundleId, workspaceId: input.context.workspaceId } });
  if (!run) throw new Error("topic_expansion_run_not_found");
  if (run.status === "awaiting_confirmation") {
    return getPrisma().topicExpansionRun.update({ data: { completedAt: new Date(), status: "cancelled" }, where: { id: run.id } });
  }
  if (["queued", "running"].includes(run.status)) {
    await getPrisma().$transaction([
      getPrisma().topicExpansionRun.update({ data: { status: "cancellation_requested" }, where: { id: run.id } }),
      getPrisma().topicExpansionResearchJob.updateMany({ data: { completedAt: new Date(), status: "cancelled" }, where: { runId: run.id, status: "queued" } }),
    ]);
    await finalizeTopicExpansionRun(run.id);
    return getPrisma().topicExpansionRun.findUniqueOrThrow({ where: { id: run.id } });
  }
  throw new Error("topic_expansion_run_not_cancellable");
}

export function validateExpansionCandidate(input: {
  allowedTypes: string[];
  concepts: ExpansionConcept[];
  proposal: z.infer<typeof topicResearchAnalysisSchema>["proposals"][number];
}): ValidatedTopicExpansionCandidate | null {
  const title = input.proposal.title.trim();
  const normalizedTitle = normalizeTopicTitle(title);
  if (!normalizedTitle || !input.allowedTypes.includes(input.proposal.topicType)) return null;
  const concepts = new Map(input.concepts.map((concept) => [concept.id, concept]));
  const evidence: ValidatedTopicExpansionCandidate["evidence"] = [];
  for (const item of input.proposal.evidence) {
    const concept = concepts.get(item.sourceTopicId);
    const chunk = concept?.chunks.find((candidate) => candidate.id === item.chunkId);
    if (!concept || !chunk) return null;
    const quote = canonicalText(item.evidenceQuote);
    if (!quote || !canonicalText(chunk.text).includes(quote)) return null;
    evidence.push({
      chunkContentHash: chunk.contentHash,
      chunkId: chunk.id,
      conceptContentHash: concept.contentHash,
      documentId: chunk.documentId,
      evidenceQuote: quote,
      sourceFilePath: concept.filePath,
      sourcePages: chunk.pages,
      sourceTopicId: concept.id,
      trustTier: concept.trustTier,
    });
  }
  const uniqueConceptIds = new Set(evidence.map(({ sourceTopicId }) => sourceTopicId));
  const singleConcept = uniqueConceptIds.size === 1 ? concepts.get([...uniqueConceptIds][0]!) : null;
  const explicitEntity = singleConcept?.entityNames.some((name) => {
    const normalizedEntity = normalizeTopicTitle(name);
    return containsMeaningfulSequence(normalizedTitle, normalizedEntity)
      && evidence.some((item) => item.sourceTopicId === singleConcept.id && containsMeaningfulSequence(normalizeTopicTitle(item.evidenceQuote), normalizedEntity));
  }) ?? false;
  if (uniqueConceptIds.size < 2 && !explicitEntity) return null;
  return {
    confidence: input.proposal.confidence,
    evidence: dedupeEvidence(evidence),
    identityFingerprint: fingerprint(`${normalizedTitle}\n${input.proposal.topicType}`),
    normalizedTitle,
    rationale: input.proposal.rationale.trim(),
    summary: input.proposal.summary.trim(),
    title,
    topicType: input.proposal.topicType,
  };
}

export function rankExpansionCandidates(candidates: ValidatedTopicExpansionCandidate[]) {
  return [...candidates].sort((left, right) => {
    const leftConcepts = new Set(left.evidence.map(({ sourceTopicId }) => sourceTopicId)).size;
    const rightConcepts = new Set(right.evidence.map(({ sourceTopicId }) => sourceTopicId)).size;
    const leftDocuments = new Set(left.evidence.map(({ documentId }) => documentId)).size;
    const rightDocuments = new Set(right.evidence.map(({ documentId }) => documentId)).size;
    const leftTrust = Math.max(...left.evidence.map(({ trustTier }) => trustRank(trustTier)));
    const rightTrust = Math.max(...right.evidence.map(({ trustTier }) => trustRank(trustTier)));
    return rightConcepts - leftConcepts || rightDocuments - leftDocuments || rightTrust - leftTrust || right.confidence - left.confidence || left.normalizedTitle.localeCompare(right.normalizedTitle);
  });
}

export async function listTopicExpansionState(input: { context: AuthWorkspaceContext; knowledgeBundleId: string }) {
  await requireActiveBundle(input);
  const db = getPrisma();
  const [runs, initialProposals, batches, approvedConceptCount] = await Promise.all([
    db.topicExpansionRun.findMany({ include: { researchJobs: { orderBy: { createdAt: "asc" }, select: { candidateCount: true, completedRounds: true, currentRound: true, evidenceChunkCount: true, heartbeatAt: true, id: true, searchQueryCount: true, sourceTopic: { select: { title: true } }, stage: true, status: true, stopReason: true, updatedAt: true } } }, orderBy: { createdAt: "desc" }, take: 10, where: { knowledgeBundleId: input.knowledgeBundleId, workspaceId: input.context.workspaceId } }),
    db.topicExpansionProposal.findMany({ include: { evidence: { include: { chunk: { select: { contentHash: true } }, document: { select: { title: true } }, sourceTopic: { select: { exportedFilePath: true, reviewStatus: true, title: true } } } }, enrichmentJobs: { orderBy: { createdAt: "desc" }, take: 1 } }, orderBy: [{ rank: "asc" }, { title: "asc" }], where: { knowledgeBundleId: input.knowledgeBundleId, workspaceId: input.context.workspaceId } }),
    db.topicExpansionEnrichmentBatch.findMany({ include: { items: true }, orderBy: { createdAt: "desc" }, take: 5, where: { knowledgeBundleId: input.knowledgeBundleId, workspaceId: input.context.workspaceId } }),
    db.topicRecord.count({ where: { exportedFilePath: { not: null }, knowledgeBundleId: input.knowledgeBundleId, reviewStatus: "approved", workspaceId: input.context.workspaceId } }),
  ]);
  const latestRun = runs[0] ?? null;
  const staleIds = initialProposals.filter((proposal) => proposal.status === "proposed" && proposal.evidence.some((evidence) => evidence.chunk.contentHash !== evidence.chunkContentHash || evidence.sourceTopic.reviewStatus !== "approved" || !evidence.sourceTopic.exportedFilePath)).map(({ id }) => id);
  if (staleIds.length > 0) await db.topicExpansionProposal.updateMany({ data: { status: "stale" }, where: { id: { in: staleIds }, workspaceId: input.context.workspaceId } });
  const proposals = staleIds.length === 0 ? initialProposals : initialProposals.map((proposal) => staleIds.includes(proposal.id) ? { ...proposal, status: "stale" } : proposal);
  const active = runs.some((run) => ["queued", "running", "consolidating", "cancellation_requested"].includes(run.status)) || batches.some((batch) => ["queued", "running", "cancellation_requested"].includes(batch.status));
  const stateFingerprint = fingerprint(JSON.stringify({ batches: batches.map(({ id, status, updatedAt }) => ({ id, status, updatedAt })), runs: runs.map(({ id, researchJobs, status, updatedAt }) => ({ id, researchJobs: researchJobs.map((job) => ({ candidateCount: job.candidateCount, completedRounds: job.completedRounds, currentRound: job.currentRound, evidenceChunkCount: job.evidenceChunkCount, heartbeatAt: job.heartbeatAt, id: job.id, searchQueryCount: job.searchQueryCount, stage: job.stage, status: job.status, updatedAt: job.updatedAt })), status, updatedAt })), proposals: proposals.map(({ id, status, updatedAt }) => ({ id, status, updatedAt })) }));
  const progressSnapshot = buildTopicExpansionProgressSnapshot({ active, fingerprint: stateFingerprint, run: latestRun });
  return { active, approvedConceptCount, batches, fingerprint: stateFingerprint, latestRun, progressSnapshot, proposals, runs };
}

function buildTopicExpansionProgressSnapshot(input: {
  active: boolean;
  fingerprint: string;
  run: {
    approvedConceptCount: number;
    id: string;
    researchJobs: Array<{ candidateCount: number; completedRounds: number; currentRound: number; evidenceChunkCount: number; heartbeatAt: Date | null; id: string; searchQueryCount: number; sourceTopic: { title: string }; stage: string; status: string; stopReason: string | null; updatedAt: Date }>;
    status: string;
    updatedAt: Date;
  } | null;
}): OperationProgressSnapshot<TopicExpansionProgressData | null> {
  const run = input.run;
  if (!run) return { active: false, data: null, fingerprint: input.fingerprint, generatedAt: new Date().toISOString(), operations: [] };
  const jobs = run.researchJobs;
  const terminal = jobs.filter((job) => ["completed", "failed", "cancelled"].includes(job.status));
  const current = jobs.find((job) => job.status === "running") ?? null;
  const data: TopicExpansionProgressData = {
    completed: jobs.filter((job) => job.status === "completed").length,
    current: current ? { candidateCount: current.candidateCount, completedRounds: current.completedRounds, currentRound: current.currentRound, evidenceChunkCount: current.evidenceChunkCount, heartbeatAt: current.heartbeatAt?.toISOString() ?? null, id: current.id, searchQueryCount: current.searchQueryCount, stage: current.stage, title: current.sourceTopic.title } : null,
    failed: jobs.filter((job) => job.status === "failed").length,
    next: jobs.filter((job) => job.status === "queued").slice(0, 3).map((job) => ({ id: job.id, title: job.sourceTopic.title })),
    queued: jobs.filter((job) => job.status === "queued").length,
    recent: terminal.slice(-3).reverse().map((job) => ({ candidateCount: job.candidateCount, completedRounds: job.completedRounds, evidenceChunkCount: job.evidenceChunkCount, id: job.id, searchQueryCount: job.searchQueryCount, stopReason: job.stopReason, title: job.sourceTopic.title })),
    runId: run.id,
    status: run.status,
    total: jobs.length || run.approvedConceptCount,
  };
  const operationStatus: OperationProgressStatus = run.status === "completed_with_warnings" ? "completed_with_warnings" : run.status === "failed" ? "failed" : run.status === "cancelled" ? "cancelled" : ["completed"].includes(run.status) ? "completed" : ["awaiting_confirmation", "awaiting_provider"].includes(run.status) ? "action_required" : "running";
  const stage = run.status === "consolidating" ? "consolidating_discoveries" : current?.stage ?? (data.queued > 0 ? "queued" : run.status);
  const completed = terminal.length;
  return {
    active: input.active,
    data,
    fingerprint: input.fingerprint,
    generatedAt: new Date().toISOString(),
    operations: [{
      completed,
      currentItem: current?.sourceTopic.title,
      currentRound: current?.currentRound,
      detail: `${completed} of ${data.total} topics finished; ${data.queued} queued${data.failed > 0 ? `; ${data.failed} failed` : ""}`,
      heartbeatAt: current?.heartbeatAt?.toISOString(),
      id: run.id,
      kind: "topic_expansion",
      label: "Topic expansion research",
      stage,
      status: operationStatus,
      total: data.total,
      totalRounds: MAX_TOPIC_RESEARCH_ROUNDS,
      updatedAt: run.updatedAt.toISOString(),
    }],
  };
}

export async function rejectTopicExpansionProposal(input: { context: AuthWorkspaceContext; knowledgeBundleId: string; proposalId: string; restore?: boolean }) {
  const proposal = await getPrisma().topicExpansionProposal.findFirst({ where: { id: input.proposalId, knowledgeBundleId: input.knowledgeBundleId, workspaceId: input.context.workspaceId } });
  if (!proposal) throw new Error("topic_expansion_proposal_not_found");
  if (proposal.promotedTopicId) throw new Error("topic_expansion_proposal_already_promoted");
  return getPrisma().topicExpansionProposal.update({ data: { status: input.restore ? "proposed" : "rejected" }, where: { id: proposal.id } });
}

export async function prepareTopicExpansionEnrichment(input: {
  context: AuthWorkspaceContext;
  knowledgeBundleId: string;
  proposalIds: string[];
}) {
  await requireActiveBundle(input);
  const proposalIds = [...new Set(input.proposalIds)].sort();
  if (proposalIds.length === 0 || proposalIds.length > MAX_TOPIC_EXPANSION_PROPOSALS) throw new Error("topic_expansion_selection_invalid");
  const proposals = await getPrisma().topicExpansionProposal.findMany({
    include: { evidence: { include: { chunk: true, sourceTopic: true } } },
    where: { id: { in: proposalIds }, knowledgeBundleId: input.knowledgeBundleId, status: "proposed", workspaceId: input.context.workspaceId },
  });
  if (proposals.length !== proposalIds.length) throw new Error("topic_expansion_selection_stale");
  for (const proposal of proposals) {
    assertCurrentProposalEvidence(proposal);
    await assertCurrentProposalEvidenceLive(proposal, input.knowledgeBundleId, input.context.workspaceId);
  }
  const selectionFingerprint = fingerprint(proposalIds.join("\n"));
  const estimatedInputTokens = proposals.reduce((sum, proposal) => sum + proposal.evidence.reduce((evidenceSum, evidence) => evidenceSum + evidence.chunk.tokenCount, 0), 0);
  const existing = await getPrisma().topicExpansionEnrichmentBatch.findUnique({
    include: { items: true },
    where: { knowledgeBundleId_selectionFingerprint: { knowledgeBundleId: input.knowledgeBundleId, selectionFingerprint } },
  });
  if (existing?.status === "cancelled") {
    return getPrisma().$transaction(async (tx) => {
      const reserved = await tx.topicExpansionProposal.updateMany({ data: { status: "selected" }, where: { id: { in: proposalIds }, promotedTopicId: null, status: "proposed" } });
      if (reserved.count !== proposalIds.length) throw new Error("topic_expansion_selection_stale");
      await tx.topicExpansionEnrichmentItem.updateMany({ data: { completedAt: null, errorCode: null, errorMessage: null, status: "pending" }, where: { batchId: existing.id } });
      return tx.topicExpansionEnrichmentBatch.update({ data: { completedAt: null, status: "awaiting_confirmation" }, include: { items: true }, where: { id: existing.id } });
    });
  }
  if (existing) return existing;
  try {
    return await getPrisma().$transaction(async (tx) => {
      const reserved = await tx.topicExpansionProposal.updateMany({
        data: { status: "selected" },
        where: { id: { in: proposalIds }, promotedTopicId: null, status: "proposed", workspaceId: input.context.workspaceId },
      });
      if (reserved.count !== proposalIds.length) throw new Error("topic_expansion_selection_stale");
      return tx.topicExpansionEnrichmentBatch.create({
        data: {
          costEstimate: { enrichmentInputTokens: estimatedInputTokens, proposalCount: proposals.length },
          estimatedInputTokens,
          items: { create: proposalIds.map((proposalId) => ({ proposalId })) },
          knowledgeBundleId: input.knowledgeBundleId,
          requestedBy: input.context.userId,
          selectionFingerprint,
          workspaceId: input.context.workspaceId,
        },
        include: { items: true },
      });
    });
  } catch (error) {
    const raced = await getPrisma().topicExpansionEnrichmentBatch.findUnique({ include: { items: true }, where: { knowledgeBundleId_selectionFingerprint: { knowledgeBundleId: input.knowledgeBundleId, selectionFingerprint } } });
    if (raced) return raced;
    throw error;
  }
}

export async function confirmTopicExpansionEnrichment(input: {
  batchId: string;
  context: AuthWorkspaceContext;
  enqueue: (payload: { jobId: string; kind: "enrich"; workspaceId: string }) => Promise<void>;
  knowledgeBundleId: string;
}) {
  const db = getPrisma();
  const batch = await db.topicExpansionEnrichmentBatch.findFirst({
    include: { items: { include: { proposal: { include: { evidence: { include: { chunk: true, sourceTopic: true } } } } } } },
    where: { id: input.batchId, knowledgeBundleId: input.knowledgeBundleId, workspaceId: input.context.workspaceId },
  });
  if (!batch) throw new Error("topic_expansion_batch_not_found");
  if (!["awaiting_confirmation", "queued", "running"].includes(batch.status)) return batch;
  for (const item of batch.items) {
    assertCurrentProposalEvidence(item.proposal);
    await assertCurrentProposalEvidenceLive(item.proposal, batch.knowledgeBundleId, batch.workspaceId);
  }
  const jobs = await db.$transaction(async (tx) => {
    const createdJobs = [];
    for (const item of batch.items) {
      if (item.topicId) {
        const existingJob = await tx.topicEnrichmentJob.findFirst({ where: { proposalId: item.proposalId, status: { in: ["queued", "running", "completed"] } } });
        if (existingJob) createdJobs.push(existingJob);
        continue;
      }
      const claim = await tx.topicExpansionProposal.updateMany({
        data: { status: "enriching" },
        where: { id: item.proposalId, promotedTopicId: null, status: "selected" },
      });
      if (claim.count === 0) {
        const current = await tx.topicExpansionProposal.findUnique({ select: { promotedTopicId: true }, where: { id: item.proposalId } });
        if (!current?.promotedTopicId) throw new Error("topic_expansion_proposal_claim_conflict");
        const existingJob = await tx.topicEnrichmentJob.findFirst({ where: { proposalId: item.proposalId, topicId: current.promotedTopicId } });
        await tx.topicExpansionEnrichmentItem.update({
          data: { status: existingJob?.status === "completed" ? "succeeded" : "queued", topicId: current.promotedTopicId },
          where: { id: item.id },
        });
        if (existingJob) createdJobs.push(existingJob);
        continue;
      }
      assertCurrentProposalEvidence(item.proposal);
      const primaryEvidence = selectPrimaryEvidence(item.proposal.evidence.map((evidence) => ({
        chunkContentHash: evidence.chunkContentHash,
        chunkId: evidence.chunkId,
        conceptContentHash: evidence.conceptContentHash,
        documentId: evidence.documentId,
        evidenceQuote: evidence.evidenceQuote,
        sourceFilePath: evidence.sourceFilePath,
        sourcePages: evidence.sourcePages,
        sourceTopicId: evidence.sourceTopicId,
        trustTier: evidence.trustTier,
      })));
      const primaryPages = [...new Set(item.proposal.evidence.filter(({ documentId }) => documentId === primaryEvidence.documentId).flatMap(({ sourcePages }) => sourcePages))].sort((a, b) => a - b);
      if (primaryPages.length === 0) throw new Error("topic_expansion_primary_pages_missing");
      const topic = await tx.topicRecord.create({
        data: {
          confidence: confidenceLabel(item.proposal.confidence),
          discoveryMetadata: { origin: "topic_expansion", proposalId: item.proposal.id, runId: item.proposal.runId, version: TOPIC_EXPANSION_PROMPT_VERSION },
          documentId: item.proposal.primaryDocumentId,
          enrichmentStatus: "none",
          knowledgeBundleId: batch.knowledgeBundleId,
          okfMetadata: {},
          originalSummary: item.proposal.summary,
          originalTitle: item.proposal.title,
          pageEnd: primaryPages.at(-1)!,
          pageStart: primaryPages[0]!,
          reviewStatus: "needs_review",
          sourcePageNumbers: primaryPages,
          summary: item.proposal.summary,
          title: item.proposal.title,
          topicType: item.proposal.topicType,
          workspaceId: batch.workspaceId,
        },
      });
      const revisionFingerprint = fingerprint(JSON.stringify({ proposalId: item.proposal.id, title: topic.title, updatedAt: topic.updatedAt.toISOString() }));
      const job = await tx.topicEnrichmentJob.create({
        data: { knowledgeBundleId: batch.knowledgeBundleId, proposalId: item.proposal.id, revisionFingerprint, topicId: topic.id, workspaceId: batch.workspaceId },
      });
      await tx.topicExpansionProposal.update({ data: { promotedTopicId: topic.id }, where: { id: item.proposal.id } });
      await tx.topicExpansionEnrichmentItem.update({ data: { status: "queued", topicId: topic.id }, where: { id: item.id } });
      createdJobs.push(job);
    }
    await tx.topicExpansionEnrichmentBatch.update({ data: { confirmedAt: batch.confirmedAt ?? new Date(), confirmedBy: batch.confirmedBy ?? input.context.userId, startedAt: batch.startedAt ?? new Date(), status: "running" }, where: { id: batch.id } });
    return createdJobs;
  });
  for (const job of jobs) await input.enqueue({ jobId: job.id, kind: "enrich", workspaceId: job.workspaceId });
  return db.topicExpansionEnrichmentBatch.findUniqueOrThrow({ include: { items: true }, where: { id: batch.id } });
}

export async function cancelTopicExpansionEnrichment(input: { batchId: string; context: AuthWorkspaceContext; knowledgeBundleId: string }) {
  const db = getPrisma();
  const batch = await db.topicExpansionEnrichmentBatch.findFirst({ include: { items: true }, where: { id: input.batchId, knowledgeBundleId: input.knowledgeBundleId, workspaceId: input.context.workspaceId } });
  if (!batch) throw new Error("topic_expansion_batch_not_found");
  if (batch.status === "awaiting_confirmation") {
    await db.$transaction([
      db.topicExpansionProposal.updateMany({ data: { status: "proposed" }, where: { id: { in: batch.items.map(({ proposalId }) => proposalId) }, promotedTopicId: null, status: "selected" } }),
      db.topicExpansionEnrichmentItem.updateMany({ data: { completedAt: new Date(), status: "cancelled" }, where: { batchId: batch.id, status: "pending" } }),
      db.topicExpansionEnrichmentBatch.update({ data: { completedAt: new Date(), status: "cancelled" }, where: { id: batch.id } }),
    ]);
    return;
  }
  if (!["queued", "running", "cancellation_requested"].includes(batch.status)) throw new Error("topic_expansion_batch_not_cancellable");
  const cancellableItems = batch.items.filter(({ status }) => ["pending", "queued"].includes(status));
  await db.$transaction([
    db.topicExpansionEnrichmentBatch.update({ data: { status: "cancellation_requested" }, where: { id: batch.id } }),
    db.topicExpansionEnrichmentItem.updateMany({ data: { completedAt: new Date(), errorCode: "topic_expansion_enrichment_cancelled", status: "cancelled" }, where: { id: { in: cancellableItems.map(({ id }) => id) } } }),
    db.topicEnrichmentJob.updateMany({ data: { errorCode: "topic_expansion_enrichment_cancelled", status: "cancelled" }, where: { topicId: { in: cancellableItems.flatMap(({ topicId }) => topicId ? [topicId] : []) }, status: "queued" } }),
    db.topicExpansionProposal.updateMany({ data: { status: "failed" }, where: { id: { in: cancellableItems.map(({ proposalId }) => proposalId) } } }),
  ]);
  await finalizeExpansionBatch(batch.id);
}

export async function runTopicExpansionEnrichmentJob(jobId: string) {
  const db = getPrisma();
  const job = await db.topicEnrichmentJob.findUnique({
    include: {
      proposal: { include: { evidence: { include: { chunk: true, document: { select: { title: true } }, sourceTopic: true } }, enrichmentItems: { include: { batch: true } } } },
      topic: true,
    },
    where: { id: jobId },
  });
  if (!job || !job.proposal) throw new Error("topic_expansion_enrichment_job_not_found");
  if (job.status === "cancelled") {
    const item = job.proposal.enrichmentItems.find(({ topicId }) => topicId === job.topicId);
    if (item) await finalizeExpansionBatch(item.batchId);
    return job;
  }
  if (job.status === "completed") return job;
  if (!await getKnowledgeBundleByIdentity({ bundleId: job.knowledgeBundleId, workspaceId: job.workspaceId })) throw new Error("knowledge_bundle_not_found");
  const item = job.proposal.enrichmentItems.find(({ topicId }) => topicId === job.topicId);
  if (!item) throw new Error("topic_expansion_enrichment_item_not_found");
  assertCurrentProposalEvidence(job.proposal);
  await assertCurrentProposalEvidenceLive(job.proposal, job.knowledgeBundleId, job.workspaceId);
  await db.topicEnrichmentJob.update({ data: { attempts: { increment: 1 }, errorCode: null, errorMessage: null, startedAt: job.startedAt ?? new Date(), status: "running" }, where: { id: job.id } });
  await db.topicExpansionEnrichmentItem.update({ data: { status: "running" }, where: { id: item.id } });
  try {
    const sourcePages = job.proposal.evidence.map((evidence) => ({
      charCount: evidence.chunk.text.length,
      imageCount: 0,
      pageNumber: evidence.sourcePages[0] ?? 1,
      tables: [],
      text: `[Document: ${evidence.document.title} | Pages: ${evidence.sourcePages.join(", ")} | Approved concept: ${evidence.sourceTopic.title}]\n${evidence.chunk.text}`,
    }));
    await enrichTopic(job.topicId, {
      context: { role: "admin", userId: item.batch.requestedBy, workspaceId: job.workspaceId },
      sourcePageMode: "exact",
      sourcePagesOverride: sourcePages,
    });
    await db.$transaction([
      db.topicEnrichmentJob.update({ data: { completedAt: new Date(), inputTokens: sourcePages.reduce((sum, page) => sum + estimateTokens(page.text), 0), status: "completed" }, where: { id: job.id } }),
      db.topicExpansionEnrichmentItem.update({ data: { completedAt: new Date(), errorCode: null, errorMessage: null, status: "succeeded" }, where: { id: item.id } }),
      db.topicExpansionProposal.update({ data: { status: "enriched" }, where: { id: job.proposal.id } }),
    ]);
    await finalizeExpansionBatch(item.batchId);
    return db.topicEnrichmentJob.findUniqueOrThrow({ where: { id: job.id } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.$transaction([
      db.topicEnrichmentJob.update({ data: { errorCode: message, errorMessage: message, status: "failed" }, where: { id: job.id } }),
      db.topicExpansionEnrichmentItem.update({ data: { completedAt: new Date(), errorCode: message, errorMessage: message, status: "failed" }, where: { id: item.id } }),
      db.topicExpansionProposal.update({ data: { status: "failed" }, where: { id: job.proposal.id } }),
    ]);
    await finalizeExpansionBatch(item.batchId);
    throw error;
  }
}

export async function reconcileTopicExpansionJobs(enqueue: (payload: TopicExpansionJobPayload) => Promise<void>) {
  const db = getPrisma();
  const [runs, researchJobs, jobs] = await Promise.all([
    db.topicExpansionRun.findMany({ include: { researchJobs: true }, where: { status: { in: ["queued", "running", "consolidating"] } } }),
    db.topicExpansionResearchJob.findMany({ where: { status: { in: ["queued", "running"] } } }),
    db.topicEnrichmentJob.findMany({ where: { status: { in: ["queued", "running"] } } }),
  ]);
  for (const run of runs) {
    if (run.researchJobs.length === 0) await enqueue({ kind: "crawl", runId: run.id, workspaceId: run.workspaceId });
  }
  for (const job of researchJobs) {
    if (job.status === "running") await db.topicExpansionResearchJob.update({ data: { status: "queued" }, where: { id: job.id } });
    await enqueue({ jobId: job.id, kind: "research", workspaceId: job.workspaceId });
  }
  for (const job of jobs) {
    if (job.status === "running") await db.topicEnrichmentJob.update({ data: { status: "queued" }, where: { id: job.id } });
    await enqueue({ jobId: job.id, kind: "enrich", workspaceId: job.workspaceId });
  }
  return { jobs: jobs.length, researchJobs: researchJobs.length, runs: runs.length };
}

async function finalizeExpansionBatch(batchId: string) {
  const db = getPrisma();
  const items = await db.topicExpansionEnrichmentItem.findMany({ where: { batchId } });
  if (items.some(({ status }) => ["pending", "queued", "running"].includes(status))) return;
  const failed = items.some(({ status }) => status === "failed");
  const cancelled = items.some(({ status }) => status === "cancelled");
  await db.topicExpansionEnrichmentBatch.update({ data: { completedAt: new Date(), status: failed ? "completed_with_failures" : cancelled ? "cancelled" : "completed" }, where: { id: batchId } });
}

function assertCurrentProposalEvidence(proposal: { evidence: Array<{ chunk: { contentHash: string; text: string }; chunkContentHash: string; conceptContentHash: string; evidenceQuote: string; sourceTopic: { exportedFilePath: string | null; reviewStatus: string } }>; status?: string }) {
  if (proposal.evidence.length === 0) throw new Error("topic_expansion_evidence_missing");
  for (const evidence of proposal.evidence) {
    if (evidence.sourceTopic.reviewStatus !== "approved" || !evidence.sourceTopic.exportedFilePath) throw new Error("topic_expansion_source_unavailable");
    if (evidence.chunk.contentHash !== evidence.chunkContentHash) throw new Error("topic_expansion_evidence_stale");
    if (!canonicalText(evidence.chunk.text).includes(canonicalText(evidence.evidenceQuote))) throw new Error("topic_expansion_quote_stale");
  }
}

async function assertCurrentProposalEvidenceLive(proposal: { evidence: Array<{ conceptContentHash: string; sourceFilePath: string; sourceTopic: { knowledgeBundleId: string; workspaceId: string } }> }, knowledgeBundleId: string, workspaceId: string) {
  const root = resolveKnowledgeBundleRoot({ bundleId: knowledgeBundleId, workspaceId });
  const lifecycleRows = await getPrisma().okfConceptLifecycle.findMany({ where: { filePath: { in: proposal.evidence.map(({ sourceFilePath }) => sourceFilePath) }, knowledgeBundleId, workspaceId } });
  const lifecycle = new Map(lifecycleRows.map((row) => [row.filePath.replaceAll("\\", "/"), row.status]));
  for (const evidence of proposal.evidence) {
    if (evidence.sourceTopic.workspaceId !== workspaceId || evidence.sourceTopic.knowledgeBundleId !== knowledgeBundleId) throw new Error("topic_expansion_source_scope_changed");
    if ((lifecycle.get(evidence.sourceFilePath) ?? "active") !== "active") throw new Error("topic_expansion_source_unavailable");
    const file = await readOkfBundleFile(root, evidence.sourceFilePath).catch(() => null);
    if (!file || fingerprint(file.content) !== evidence.conceptContentHash) throw new Error("topic_expansion_concept_stale");
  }
}

function confidenceLabel(value: number) { return value >= 0.85 ? "high" : value >= 0.65 ? "medium" : "low"; }

async function loadExpansionConcepts(knowledgeBundleId: string, workspaceId: string): Promise<ExpansionConcept[]> {
  const db = getPrisma();
  const topics = await db.topicRecord.findMany({
    include: {
      entityOccurrences: { include: { entity: { select: { canonicalName: true } } } },
      knowledgeBundle: { select: { status: true } },
    },
    orderBy: [{ exportedFilePath: "asc" }, { id: "asc" }],
    where: { document: { deletedAt: null, knowledgeBundleId }, exportedFilePath: { not: null }, knowledgeBundleId, reviewStatus: "approved", workspaceId },
  });
  const lifecycle = await db.okfConceptLifecycle.findMany({ where: { knowledgeBundleId, workspaceId } });
  const lifecycleByPath = new Map(lifecycle.map((row) => [row.filePath.replaceAll("\\", "/"), row.status]));
  const links = await db.okfConceptChunkLink.findMany({
    include: { chunk: true },
    where: { knowledgeBundleId, okfConceptId: { in: topics.map(({ id }) => id) }, workspaceId },
  });
  const linksByTopic = new Map<string, typeof links>();
  for (const link of links) linksByTopic.set(link.okfConceptId, [...(linksByTopic.get(link.okfConceptId) ?? []), link]);
  const root = resolveKnowledgeBundleRoot({ bundleId: knowledgeBundleId, workspaceId });
  const concepts: ExpansionConcept[] = [];
  for (const topic of topics) {
    const filePath = topic.exportedFilePath!.replaceAll("\\", "/");
    if ((lifecycleByPath.get(filePath) ?? "active") !== "active") continue;
    const file = await readOkfBundleFile(root, filePath).catch(() => null);
    if (!file) continue;
    const parsed = parseOkfMarkdown(file.content);
    if (parsed.frontmatter.status !== "stable") continue;
    const verified = Array.isArray(parsed.frontmatter.verified) ? parsed.frontmatter.verified : parsed.frontmatter.verified ? [parsed.frontmatter.verified] : [];
    if (verified.length === 0) continue;
    const contentHash = fingerprint(file.content);
    const chunks = (linksByTopic.get(topic.id) ?? []).map(({ chunk }) => ({ contentHash: chunk.contentHash, documentId: chunk.documentId, id: chunk.id, pages: chunk.sourcePageNumbers, text: chunk.text }));
    if (chunks.length === 0) continue;
    concepts.push({
      approvalMode: topic.approvalMode,
      body: parsed.body,
      chunks,
      contentHash,
      documentId: topic.documentId,
      entityNames: [...new Set(topic.entityOccurrences.map(({ entity }) => entity.canonicalName))],
      filePath,
      id: topic.id,
      title: String(parsed.frontmatter.title ?? topic.title),
      topicType: topic.topicType,
      trustTier: topic.approvalMode === "automated" ? "automated" : topic.approvalMode?.startsWith("human") ? "human" : "legacy",
    });
  }
  return concepts;
}

function buildCriticPrompt(candidates: ValidatedTopicExpansionCandidate[]) {
  return [
    `Select at most ${MAX_TOPIC_EXPANSION_PROPOSALS} proposal IDs that are specific, non-duplicative missing topics.`,
    ...candidates.map((candidate) => JSON.stringify({ confidence: candidate.confidence, id: candidate.identityFingerprint, rationale: candidate.rationale, sourceConceptCount: new Set(candidate.evidence.map(({ sourceTopicId }) => sourceTopicId)).size, sourceDocumentCount: new Set(candidate.evidence.map(({ documentId }) => documentId)).size, summary: candidate.summary, title: candidate.title, type: candidate.topicType })),
  ].join("\n");
}

async function createDefaultProvider(workspaceId: string): Promise<TopicExpansionProvider> {
  const key = await getWorkspaceLlmApiKeyForEnrichment(workspaceId);
  if (!key) throw new Error("topic_expansion_requires_api_key");
  const descriptor = getLlmProvider(key.provider);
  return {
    model: descriptor.model,
    provider: key.provider,
    async analyze({ prompt, system }) {
      return (await generateText({ maxOutputTokens: 6_000, model: getSdkModel(key.provider, key.apiKey), output: Output.object({ schema: topicResearchAnalysisSchema }), prompt, system, temperature: 0 })).output;
    },
    async critique({ prompt, system }) {
      return (await generateText({ maxOutputTokens: 1_000, model: getSdkModel(key.provider, key.apiKey), output: Output.object({ schema: criticSchema }), prompt, system, temperature: 0 })).output;
    },
    async plan({ prompt, system }) {
      return (await generateText({ maxOutputTokens: 1_500, model: getSdkModel(key.provider, key.apiKey), output: Output.object({ schema: topicResearchPlanSchema }), prompt, system, temperature: 0 })).output;
    },
  };
}

async function requireActiveBundle(input: { context: AuthWorkspaceContext; knowledgeBundleId: string }) {
  const bundle = await getKnowledgeBundleByIdentity({ bundleId: input.knowledgeBundleId, workspaceId: input.context.workspaceId });
  if (!bundle) throw new Error("knowledge_bundle_not_found");
  return bundle;
}

function hashCorpus(concepts: ExpansionConcept[]) {
  return fingerprint(`${TOPIC_EXPANSION_PROMPT_VERSION}\n${concepts.map(({ contentHash, filePath }) => `${filePath}:${contentHash}`).sort().join("\n")}`);
}

function isDuplicateTitle(candidate: string, existing: string[]) {
  const candidateTerms = new Set(candidate.split(" ").filter(Boolean));
  return existing.some((title) => {
    if (candidate === title) return true;
    const terms = new Set(title.split(" ").filter(Boolean));
    const intersection = [...candidateTerms].filter((term) => terms.has(term)).length;
    return intersection / Math.max(candidateTerms.size, terms.size, 1) >= 0.8;
  });
}

function selectPrimaryEvidence(evidence: ValidatedTopicExpansionCandidate["evidence"]) {
  return [...evidence].sort((left, right) => trustRank(right.trustTier) - trustRank(left.trustTier) || left.sourceFilePath.localeCompare(right.sourceFilePath) || left.chunkId.localeCompare(right.chunkId))[0]!;
}

function trustRank(value: string) { return value === "human" ? 3 : value === "automated" ? 2 : 1; }
function normalizeTopicTitle(value: string) { return canonicalText(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim(); }
function containsMeaningfulSequence(value: string, sequence: string) { return sequence.split(" ").filter(Boolean).length >= 2 && (` ${value} `).includes(` ${sequence} `); }
function canonicalText(value: string) { return value.normalize("NFKC").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200D\uFEFF]/g, "").replace(/\s+/g, " ").trim(); }
function fingerprint(value: string) { return createHash("sha256").update(value).digest("hex"); }
function dedupeEvidence<T extends { chunkId: string; evidenceQuote: string; sourceTopicId: string }>(evidence: T[]) { return [...new Map(evidence.map((item) => [`${item.sourceTopicId}\0${item.chunkId}\0${item.evidenceQuote}`, item])).values()]; }

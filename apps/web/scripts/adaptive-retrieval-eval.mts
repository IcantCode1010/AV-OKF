import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  ADAPTIVE_EVALUATION_BUNDLES,
  ADAPTIVE_EVALUATION_CASES,
  type AdaptiveEvaluationBundleFixture,
} from "../src/lib/adaptive-retrieval-evaluation-corpus.ts";
import {
  compareAdaptiveEvaluationModes,
  scoreAdaptiveEvaluationTrial,
  summarizeAdaptiveEvaluationMode,
  validateAdaptiveEvaluationCases,
  type AdaptiveEvaluationComparison,
  type AdaptiveEvaluationModeSummary,
  type AdaptiveEvaluationTrial,
} from "../src/lib/adaptive-retrieval-evaluation.ts";
import type { Stage6aRouterTrace } from "../src/lib/chat-router.ts";
import type { ChatCitation } from "../src/lib/chat-types.ts";
import { getEmbeddingProvider } from "../src/lib/embedding-provider.ts";
import {
  activateKnowledgeProfileVersion,
  createKnowledgeBundle,
  createKnowledgeProfileDraft,
  getKnowledgeBundle,
  resolveKnowledgeBundleRoot,
  scaffoldKnowledgeBundle,
  writeWorkspaceVault,
} from "../src/lib/knowledge-bundles.ts";
import { getPrisma } from "../src/lib/prisma.ts";
import { createPostgresChatRepository } from "../src/lib/production-chat-repository.ts";
import { createProductionChatService } from "../src/lib/production-chat-service.ts";
import { buildDocumentObjectKey, getObjectStorage } from "../src/lib/production-storage.ts";
import { runRagIndexJob } from "../src/lib/rag-indexer.ts";
import { createRagRepository } from "../src/lib/rag-repository.ts";
import {
  getWorkspaceLlmApiKeyForEnrichment,
  saveWorkspaceLlmApiKey,
} from "../src/lib/llm-provider-settings.ts";

const EVAL_USER_ID = "e2e-adaptive-retrieval";
const EVAL_WORKSPACE_ID = "adaptive_retrieval_eval_workspace_v1";
const RETRACTED_FILE = "concepts/reference/retracted-decoy.md";
const EVAL_PDF_BYTES = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n",
  "utf8",
);

type EvalContext = {
  role: "admin";
  userId: string;
  workspaceId: string;
};

type SeededBundle = AdaptiveEvaluationBundleFixture & {
  id: string;
  rawDocumentId: string;
};

type AdaptiveModeReport = {
  evaluatedAt: string;
  mode: "baseline" | "candidate";
  summary: AdaptiveEvaluationModeSummary;
  trials: AdaptiveEvaluationTrial[];
  workspaceId: string;
};

export async function runAdaptiveRetrievalEval(input: {
  baselinePath: string;
  candidatePath: string;
  comparisonPath: string;
  humanReviewPassed?: boolean;
  reviewPath: string;
  routeSuitePassed: boolean;
  workspaceId: string;
  worksheetPath: string;
}): Promise<{
  baseline: AdaptiveModeReport;
  candidate: AdaptiveModeReport;
  comparison: AdaptiveEvaluationComparison;
}> {
  const caseErrors = validateAdaptiveEvaluationCases(ADAPTIVE_EVALUATION_CASES);
  if (caseErrors.length > 0) {
    throw new Error(`adaptive_eval_invalid_cases:${caseErrors.join(",")}`);
  }

  const workspaceId = await resolveIsolatedEvalWorkspace(input.workspaceId);
  const context: EvalContext = {
    role: "admin",
    userId: EVAL_USER_ID,
    workspaceId,
  };
  const bundles = await seedAdaptiveEvaluationCorpus(context);
  const bundleBySlug = new Map(bundles.map((bundle) => [bundle.slug, bundle]));
  const db = getPrisma();
  const repository = createPostgresChatRepository(db);
  const service = createProductionChatService(repository, {
    getContext: async () => context,
  });

  let baseline: AdaptiveModeReport | undefined;
  let candidate: AdaptiveModeReport | undefined;
  try {
    await setAdaptiveRetryForBundles(context, bundles, false);
    baseline = await runMode({
      bundleBySlug,
      context,
      mode: "baseline",
      service,
    });
    await writeJson(input.baselinePath, baseline);

    await setAdaptiveRetryForBundles(context, bundles, true);
    candidate = await runMode({
      bundleBySlug,
      context,
      mode: "candidate",
      service,
    });
    await writeJson(input.candidatePath, candidate);
  } finally {
    await setAdaptiveRetryForBundles(context, bundles, false);
    await db.chatSession.deleteMany({
      where: {
        userId: EVAL_USER_ID,
        workspaceId,
      },
    });
  }

  if (!baseline || !candidate) {
    throw new Error("adaptive_eval_mode_incomplete");
  }
  const comparison = compareAdaptiveEvaluationModes({
    baseline: baseline.summary,
    candidate: candidate.summary,
    environmentValid: true,
    humanReviewPassed: input.humanReviewPassed ?? false,
    routeSuitePassed: input.routeSuitePassed,
  });
  await writeJson(input.comparisonPath, comparison);
  await writeBlindedWorksheet({
    baseline,
    candidate,
    outputPath: input.worksheetPath,
  });
  await writeReview({
    baseline,
    candidate,
    comparison,
    outputPath: input.reviewPath,
  });
  console.log(`ADAPTIVE_RETRIEVAL_EVAL_JSON=${JSON.stringify(comparison)}`);
  if (
    comparison.gates.routeSuitePassed === false ||
    comparison.gates.noPolicyViolations === false
  ) {
    process.exitCode = 1;
  }
  await db.$disconnect();
  return { baseline, candidate, comparison };
}

async function resolveIsolatedEvalWorkspace(
  providerSourceWorkspaceId: string,
): Promise<string> {
  const providerKey = await getWorkspaceLlmApiKeyForEnrichment(
    providerSourceWorkspaceId,
  );
  if (!providerKey) throw new Error("adaptive_eval_workspace_llm_key_required");
  const db = getPrisma();
  await db.workspace.upsert({
    create: {
      id: EVAL_WORKSPACE_ID,
      name: "Adaptive Retrieval Evaluation",
    },
    update: {},
    where: { id: EVAL_WORKSPACE_ID },
  });
  await db.chatSession.deleteMany({
    where: {
      userId: EVAL_USER_ID,
      workspaceId: EVAL_WORKSPACE_ID,
    },
  });
  await saveWorkspaceLlmApiKey(
    EVAL_WORKSPACE_ID,
    providerKey.provider,
    providerKey.apiKey,
    { updatedBy: EVAL_USER_ID },
  );
  await db.ragRerankDailyUsage.deleteMany({
    where: { workspaceId: EVAL_WORKSPACE_ID },
  });
  return EVAL_WORKSPACE_ID;
}

async function runMode(input: {
  bundleBySlug: Map<string, SeededBundle>;
  context: EvalContext;
  mode: "baseline" | "candidate";
  service: ReturnType<typeof createProductionChatService>;
}): Promise<AdaptiveModeReport> {
  const db = getPrisma();
  const trials: AdaptiveEvaluationTrial[] = [];

  for (const definition of ADAPTIVE_EVALUATION_CASES) {
    const bundle = input.bundleBySlug.get(definition.bundleSlug);
    if (!bundle) throw new Error(`adaptive_eval_bundle_missing:${definition.bundleSlug}`);

    for (let trialNumber = 1; trialNumber <= 3; trialNumber += 1) {
      if (definition.expectedInitialSufficiency === "weak") {
        await removeWeakTargetEmbedding({
          bundleId: bundle.id,
          filePath: definition.requiredCitationTargets[0],
          workspaceId: input.context.workspaceId,
        });
      }
      const session = await input.service.createSession(
        bundle.id,
        `Adaptive ${input.mode}: ${definition.id} #${trialNumber}`,
      );
      const startedAt = performance.now();
      const sent = await input.service.sendMessage(session.id, definition.query);
      const latencyMs = Math.round(performance.now() - startedAt);
      const persisted = await db.chatMessage.findUnique({
        select: {
          citations: true,
          content: true,
          knowledgeBundleIds: true,
          trace: true,
        },
        where: { id: sent.assistantMessage.id },
      });
      if (!persisted?.trace) {
        throw new Error(`adaptive_eval_trace_missing:${definition.id}:${trialNumber}`);
      }
      const trace = persisted.trace as unknown as Stage6aRouterTrace;
      const citations = persisted.citations as unknown as ChatCitation[];
      const scoredCitations = citations.map((citation) => ({
        ...(citation.knowledgeBundleId
          ? { knowledgeBundleId: citation.knowledgeBundleId }
          : {}),
        sourceType: citation.sourceType,
        target:
          citation.sourceType === "okf"
            ? citation.okfFilePath ?? citation.documentTitle
            : citation.documentTitle,
      }));
      const scored = scoreAdaptiveEvaluationTrial({
        caseDefinition: definition,
        citations: scoredCitations,
        expectedBundleIds: [bundle.id],
        mode: input.mode,
        trace: {
          adaptiveRetry: trace.adaptiveRetry,
          answerEvidenceTrustLevel: trace.answerEvidenceProfile?.trustLevel,
          answerValidationStatus: trace.answerValidation?.status,
          evidenceSufficiency: trace.evidenceSufficiency,
          route: trace.route,
          selectedBundleIds:
            trace.bundleScope?.bundleIds ?? persisted.knowledgeBundleIds,
        },
      });
      const policyViolations = [
        ...scored.policyViolations,
        ...assertRuntimePolicy({
          citations,
          definition,
          mode: input.mode,
          trace,
        }),
      ];
      const qualityFailures = scored.qualityFailures;
      const correct =
        scored.citationTargetsFound.length ===
          definition.requiredCitationTargets.length &&
        qualityFailures.length === 0 &&
        policyViolations.length === 0;
      trials.push({
        adaptiveRetry: trace.adaptiveRetry,
        answerContent: persisted.content,
        answerValidationStatus: trace.answerValidation?.status,
        citationTargetsFound: scored.citationTargetsFound,
        citations: scoredCitations,
        correct,
        expectedCitationTargets: definition.requiredCitationTargets,
        id: definition.id,
        latencyMs,
        mode: input.mode,
        policyViolations,
        qualityFailures,
        route: trace.route,
        selectedBundleIds:
          trace.bundleScope?.bundleIds ?? persisted.knowledgeBundleIds,
        trial: trialNumber,
      });
      console.log(
        `adaptive_eval_progress mode=${input.mode} case=${definition.id} trial=${trialNumber} correct=${correct}`,
      );
    }
  }

  return {
    evaluatedAt: new Date().toISOString(),
    mode: input.mode,
    summary: summarizeAdaptiveEvaluationMode(
      ADAPTIVE_EVALUATION_CASES,
      trials,
      input.mode,
    ),
    trials,
    workspaceId: input.context.workspaceId,
  };
}

function assertRuntimePolicy(input: {
  citations: ChatCitation[];
  definition: (typeof ADAPTIVE_EVALUATION_CASES)[number];
  mode: "baseline" | "candidate";
  trace: Stage6aRouterTrace;
}): string[] {
  const violations: string[] = [];
  const retry = input.trace.adaptiveRetry;
  const okfCount = input.citations.filter((citation) => citation.sourceType === "okf").length;
  const ragCount = input.citations.filter((citation) => citation.sourceType === "rag").length;
  if (okfCount > 4) violations.push(`okf_evidence_limit_exceeded:${okfCount}`);
  if (ragCount > 6) violations.push(`rag_evidence_limit_exceeded:${ragCount}`);
  if (input.mode === "baseline" && retry?.outcome !== "disabled") {
    violations.push(`baseline_retry_not_disabled:${retry?.outcome ?? "missing"}`);
  }
  if (
    input.mode === "candidate" &&
    retry?.outcome === "applied" &&
    !retry.retryQuery
  ) {
    violations.push("applied_retry_query_missing");
  }
  if (
    retry?.retryQuery &&
    input.definition.protectedIdentifiers.some(
      (identifier) => !retry.retryQuery?.includes(identifier),
    )
  ) {
    violations.push("protected_identifier_dropped");
  }
  if (
    input.citations.some(
      (citation) =>
        citation.okfFilePath === RETRACTED_FILE ||
        Boolean(citation.lifecycleNotice),
    )
  ) {
    violations.push("inactive_source_cited");
  }
  return violations;
}

async function seedAdaptiveEvaluationCorpus(
  context: EvalContext,
): Promise<SeededBundle[]> {
  const seeded: SeededBundle[] = [];
  for (const fixture of ADAPTIVE_EVALUATION_BUNDLES) {
    const bundle = await ensureBundle(context, fixture);
    const rawDocumentId = await seedRawDocument({
      bundleId: bundle.id,
      fixture,
      workspaceId: context.workspaceId,
    });
    seeded.push({ ...fixture, id: bundle.id, rawDocumentId });
  }
  await writeWorkspaceVault(context.workspaceId);
  return seeded;
}

async function ensureBundle(
  context: EvalContext,
  fixture: AdaptiveEvaluationBundleFixture,
) {
  const db = getPrisma();
  const existing = await db.knowledgeBundle.findUnique({
    where: {
      workspaceId_slug: {
        slug: fixture.slug,
        workspaceId: context.workspaceId,
      },
    },
  });
  const bundle = existing ?? await createKnowledgeBundle({
    context,
    description: fixture.description,
    name: fixture.name,
    templateId: "generic",
  });
  if (existing) {
    await db.knowledgeBundle.update({ data: { okfVersion: "0.2" }, where: { id: bundle.id } });
  }
  const current = await getKnowledgeBundle({ bundleId: bundle.id, context });
  if (!current) throw new Error(`adaptive_eval_bundle_unavailable:${fixture.slug}`);
  await scaffoldKnowledgeBundle({
    bundleId: bundle.id,
    profile: current.profile,
    workspaceId: context.workspaceId,
  });
  await writeConceptFiles({
    bundleId: bundle.id,
    fixture,
    workspaceId: context.workspaceId,
  });
  return { id: bundle.id };
}

async function writeConceptFiles(input: {
  bundleId: string;
  fixture: AdaptiveEvaluationBundleFixture;
  workspaceId: string;
}) {
  const db = getPrisma();
  const root = resolveKnowledgeBundleRoot(input);
  const links: string[] = [];
  await writeAdaptiveSourceReference(root, input.fixture.rawDocument.title);
  for (const concept of input.fixture.concepts) {
    const markdown = renderConcept(input.fixture.rawDocument.title, concept);
    const fullPath = path.join(root, ...concept.filePath.split("/"));
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, markdown, "utf8");
    links.push(`- [${concept.title}](${concept.filePath})`);
    await db.okfConceptLifecycle.deleteMany({
      where: {
        filePath: concept.filePath,
        knowledgeBundleId: input.bundleId,
        workspaceId: input.workspaceId,
      },
    });
  }
  const retractedPath = path.join(root, ...RETRACTED_FILE.split("/"));
  await mkdir(path.dirname(retractedPath), { recursive: true });
  await writeFile(
    retractedPath,
    renderRetractedConcept(input.fixture.rawDocument.title),
    "utf8",
  );
  await db.okfConceptLifecycle.upsert({
    create: {
      changedBy: EVAL_USER_ID,
      filePath: RETRACTED_FILE,
      knowledgeBundleId: input.bundleId,
      reason: "Adaptive evaluation negative control.",
      status: "retracted",
      workspaceId: input.workspaceId,
    },
    update: {
      changedBy: EVAL_USER_ID,
      reason: "Adaptive evaluation negative control.",
      status: "retracted",
    },
    where: {
      knowledgeBundleId_filePath: {
        filePath: RETRACTED_FILE,
        knowledgeBundleId: input.bundleId,
      },
    },
  });
  await writeFile(
    path.join(root, "index.md"),
    [
      "---",
      'okf_version: "0.2"',
      "---",
      "",
      `# ${input.fixture.name}`,
      "",
      ...links,
      "",
    ].join("\n"),
    "utf8",
  );
}

async function writeAdaptiveSourceReference(root: string, sourceTitle: string) {
  const slug = sourceTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const target = path.join(root, "references", "sources", `${slug}.md`);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, [
    "---",
    "type: reference",
    `title: ${JSON.stringify(sourceTitle)}`,
    `resource: urn:sha256:${hash(sourceTitle)}`,
    "status: stable",
    "generated:",
    "  by: process:e2e-adaptive-retrieval",
    "  at: 2026-07-25T12:00:00.000Z",
    "av_okf_role: source_document",
    "---",
    "",
    "Evaluation source identity.",
    "",
  ].join("\n"), "utf8");
}

async function seedRawDocument(input: {
  bundleId: string;
  fixture: AdaptiveEvaluationBundleFixture;
  workspaceId: string;
}): Promise<string> {
  const db = getPrisma();
  const documentId = `adaptive_eval_${hash(
    `${input.workspaceId}:${input.fixture.slug}`,
  ).slice(0, 20)}`;
  const objectKey = buildDocumentObjectKey({
    documentId,
    objectId: hash(`${input.fixture.slug}:pdf`).slice(0, 20),
    workspaceId: input.workspaceId,
  });
  await getObjectStorage().putObject({
    body: EVAL_PDF_BYTES,
    contentType: "application/pdf",
    key: objectKey,
  });
  await db.document.deleteMany({
    where: { id: documentId, workspaceId: input.workspaceId },
  });
  await db.document.create({
    data: {
      description: "Isolated unreviewed adaptive-retrieval evaluation source.",
      extractedPages: {
        create: input.fixture.rawDocument.pages.map((page, index) => {
          const weakQuery = ADAPTIVE_EVALUATION_CASES.filter(
            (definition) =>
              definition.bundleSlug === input.fixture.slug &&
              definition.expectedInitialSufficiency === "weak",
          )[index]?.query;
          const text = [
            page.text,
            weakQuery
              ? `Unreviewed near match: ${weakQuery} This field index identifies the issue but does not state the controlling limits or required steps.`
              : "",
          ].filter(Boolean).join("\n\n");
          return {
          charCount: text.length,
          imageCount: 0,
          pageNumber: page.pageNumber,
          tables: [],
          text,
          workspaceId: input.workspaceId,
          };
        }),
      },
      fileType: "PDF",
      id: documentId,
      knowledgeBundleId: input.bundleId,
      mimeType: "application/pdf",
      objects: {
        create: {
          bucket: process.env.S3_BUCKET ?? "av-okf",
          contentType: "application/pdf",
          kind: "original_pdf",
          objectKey,
          sizeBytes: EVAL_PDF_BYTES.length,
          workspaceId: input.workspaceId,
        },
      },
      originalFilename: `${input.fixture.slug}.pdf`,
      owner: "Adaptive Retrieval Evaluation",
      pages: input.fixture.rawDocument.pages.length,
      ragStatus: "not_indexed",
      size: `${EVAL_PDF_BYTES.length} B`,
      sizeBytes: EVAL_PDF_BYTES.length,
      sourceType: "PDF",
      status: "ready",
      tags: ["evaluation", input.fixture.domain],
      title: input.fixture.rawDocument.title,
      updatedLabel: "Now",
      workspaceId: input.workspaceId,
    },
  });
  const repository = createRagRepository(db);
  const job = await repository.createIndexJob({
    documentId,
    workspaceId: input.workspaceId,
  });
  await runRagIndexJob(
    {
      chunkingStrategyId: "paragraph-context-v2",
      documentId,
      indexJobId: job.id,
      indexVersion: job.indexVersion,
      mode: "initial",
      workspaceId: input.workspaceId,
    },
    { embeddingProvider: getEmbeddingProvider(), repository },
  );
  return documentId;
}

async function setAdaptiveRetryForBundles(
  context: EvalContext,
  bundles: SeededBundle[],
  enabled: boolean,
) {
  for (const bundle of bundles) {
    const current = await getKnowledgeBundle({ bundleId: bundle.id, context });
    if (!current) throw new Error(`adaptive_eval_bundle_unavailable:${bundle.id}`);
    if (current.profile.agent.boundedAdaptiveRetryEnabled === enabled) continue;
    const profile = structuredClone(current.profile);
    profile.agent.boundedAdaptiveRetryEnabled = enabled;
    const version = await createKnowledgeProfileDraft({
      bundleId: bundle.id,
      context,
      profile,
    });
    await activateKnowledgeProfileVersion({
      bundleId: bundle.id,
      context,
      version,
    });
  }
}

async function removeWeakTargetEmbedding(input: {
  bundleId: string;
  filePath: string;
  workspaceId: string;
}) {
  const db = getPrisma();
  const where = {
    filePath: input.filePath,
    knowledgeBundleId: input.bundleId,
    workspaceId: input.workspaceId,
  };
  await db.$transaction([
    db.okfConceptEmbedding.deleteMany({ where }),
    db.okfConceptEmbeddingJob.deleteMany({ where }),
  ]);
}

function renderConcept(
  sourceFile: string,
  concept: AdaptiveEvaluationBundleFixture["concepts"][number],
): string {
  return [
    "---",
    `type: ${concept.type}`,
    `title: "${concept.title}"`,
    `description: "${concept.description}"`,
    "tags:",
    ...concept.tags.map((tag) => `  - ${tag}`),
    "status: stable",
    "verified:",
    '  - by: "human:e2e-adaptive-retrieval"',
    '    at: "2026-07-25T12:00:00.000Z"',
    "sources:",
    `  - resource: "/references/sources/${sourceFile.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.md"`,
    `    title: "${sourceFile}"`,
    "source_pages:",
    `  - ${concept.page}`,
    'av_okf_approval_mode: "human_individual"',
    "---",
    "",
    concept.body,
    "",
  ].join("\n");
}

function renderRetractedConcept(sourceFile: string): string {
  return [
    "---",
    "type: reference",
    'title: "Retracted Evaluation Decoy"',
    'description: "A negative-control concept that must never appear."',
    "status: stable",
    "verified:",
    '  - by: "human:e2e-adaptive-retrieval"',
    '    at: "2026-07-25T12:00:00.000Z"',
    "sources:",
    `  - resource: "/references/sources/${sourceFile.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.md"`,
    `    title: "${sourceFile}"`,
    "source_pages:",
    "  - 99",
    "---",
    "",
    "This retired guidance is unavailable for current answers.",
    "",
  ].join("\n");
}

async function writeBlindedWorksheet(input: {
  baseline: AdaptiveModeReport;
  candidate: AdaptiveModeReport;
  outputPath: string;
}) {
  const rows = ADAPTIVE_EVALUATION_CASES.flatMap((definition) => {
    const baseline = input.baseline.trials.find(
      (trial) => trial.id === definition.id && trial.trial === 1,
    );
    const candidate = input.candidate.trials.find(
      (trial) => trial.id === definition.id && trial.trial === 1,
    );
    if (!baseline || !candidate) throw new Error(`adaptive_eval_trial_missing:${definition.id}`);
    return [
      { answer: baseline.answerContent, citations: baseline.citations, definition, mode: "baseline" },
      { answer: candidate.answerContent, citations: candidate.citations, definition, mode: "candidate" },
    ];
  }).sort((left, right) =>
    hash(`${left.definition.id}:${left.mode}`).localeCompare(
      hash(`${right.definition.id}:${right.mode}`),
    ),
  );
  const lines = [
    "# Blinded Adaptive Retrieval Review Worksheet",
    "",
    "Score each response as `supported`, `complete`, `partially_complete`, or `incorrect`.",
    "Mode labels are intentionally omitted. Any new incorrect response blocks promotion.",
    "",
  ];
  rows.forEach((row, index) => {
    lines.push(
      `## Review ${String(index + 1).padStart(3, "0")}`,
      "",
      `**Question:** ${row.definition.query}`,
      "",
      `**Answer:** ${row.answer}`,
      "",
      `**Citations:** ${row.citations.map((citation) => citation.target).join(", ") || "None"}`,
      "",
      "**Rating:**",
      "",
      "**Notes:**",
      "",
    );
  });
  await writeText(input.outputPath, lines.join("\n"));
}

async function writeReview(input: {
  baseline: AdaptiveModeReport;
  candidate: AdaptiveModeReport;
  comparison: AdaptiveEvaluationComparison;
  outputPath: string;
}) {
  const { baseline, candidate, comparison } = input;
  await writeText(
    input.outputPath,
    [
      "# 30-Question Adaptive Retrieval Evaluation",
      "",
      `- Decision: \`${comparison.decision}\``,
      `- Baseline correctly cited: ${baseline.summary.correctQuestionCount}/30`,
      `- Candidate correctly cited: ${candidate.summary.correctQuestionCount}/30`,
      `- Question gain: ${comparison.questionGain}`,
      `- Baseline citation precision: ${formatPercent(baseline.summary.citationPrecision)}`,
      `- Candidate citation precision: ${formatPercent(candidate.summary.citationPrecision)}`,
      `- Candidate provider calls: ${candidate.summary.providerCallCount}`,
      `- Candidate tokens: ${candidate.summary.totalTokens}`,
      `- Baseline latency p50/p95: ${baseline.summary.latencyMs.p50}/${baseline.summary.latencyMs.p95} ms`,
      `- Candidate latency p50/p95: ${candidate.summary.latencyMs.p50}/${candidate.summary.latencyMs.p95} ms`,
      `- Policy violations: ${candidate.summary.policyViolationCount}`,
      `- Candidate quality failures: ${candidate.summary.qualityFailureCount}`,
      `- Human review: ${comparison.gates.humanReviewPassed ? "passed" : "pending"}`,
      "",
      "## Gates",
      "",
      ...Object.entries(comparison.gates).map(([gate, passed]) => `- ${gate}: ${passed ? "PASS" : "FAIL"}`),
      "",
      "## Regressions",
      "",
      comparison.regressionIds.length > 0
        ? comparison.regressionIds.map((id) => `- ${id}`).join("\n")
        : "- None",
      "",
      "## Decision Reasons",
      "",
      ...comparison.reasons.map((reason) => `- ${reason}`),
      "",
      "The blinded worksheet must be completed before an internal pilot can be promoted.",
      "",
    ].join("\n"),
  );
}

async function writeJson(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeText(filePath: string, value: string) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${value.trimEnd()}\n`, "utf8");
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

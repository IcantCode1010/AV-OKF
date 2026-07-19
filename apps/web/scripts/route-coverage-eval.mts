import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { getEmbeddingProvider } from "../src/lib/embedding-provider.ts";
import {
  createKnowledgeBundle,
  resolveKnowledgeBundleRoot,
  scaffoldKnowledgeBundle,
  writeWorkspaceVault,
} from "../src/lib/knowledge-bundles.ts";
import { GENERIC_PROFILE_TEMPLATE } from "../src/lib/knowledge-profile.ts";
import {
  createOkfConceptEmbeddingRepository,
  queueOkfConceptEmbedding,
} from "../src/lib/okf-concept-embedding.ts";
import { getPrisma } from "../src/lib/prisma.ts";
import { createPostgresChatRepository } from "../src/lib/production-chat-repository.ts";
import { createProductionChatService } from "../src/lib/production-chat-service.ts";
import { runRagIndexJob } from "../src/lib/rag-indexer.ts";
import { createRagRepository } from "../src/lib/rag-repository.ts";
import type { Stage6aRouterTrace } from "../src/lib/chat-router.ts";
import type { ChatCitation } from "../src/lib/chat-types.ts";
import {
  getWorkspaceLlmApiKeyForEnrichment,
  saveWorkspaceLlmApiKey,
} from "../src/lib/llm-provider-settings.ts";

const EVAL_USER_ID = "e2e-route-coverage";
const BUNDLE_NAME = "Route Coverage Evaluation";
const BUNDLE_SLUG = "route-coverage-evaluation";
const DOCUMENT_ID = "route_coverage_eval_document_v1";
const RAW_DOCUMENT_TITLE = "Route Coverage Raw Operations Log";
const ACTIVE_FILES = {
  audit: "concepts/policy/audit-retention-standard.md",
  graphTarget: "concepts/procedure/power-balance-guard.md",
  thermal: "concepts/procedure/thermal-regulation-protocol.md",
} as const;
const RETRACTED_FILE = "concepts/procedure/retired-thermal-regulation.md";

type RouteCase = {
  expectedCitationTargets: string[];
  id: string;
  mutateBefore?: "remove_okf_embeddings";
  query: string;
  verify(input: PersistedTurn): string[];
};

type PersistedTurn = {
  assistantContent: string;
  citations: ChatCitation[];
  trace: Stage6aRouterTrace;
};

export async function runRouteCoverageEval(input: {
  baselinePath?: string;
  outputPath?: string;
  phase: string;
}) {
  const db = getPrisma();
  const workspaceId = await resolveEvalWorkspace();
  const context = { role: "admin", userId: EVAL_USER_ID, workspaceId } as const;
  const bundle = await seedBundle(context);
  await seedRagDocument({ bundleId: bundle.id, workspaceId });
  await seedConcepts({ bundleId: bundle.id, workspaceId });

  await db.chatSession.deleteMany({ where: { userId: EVAL_USER_ID, workspaceId } });
  const repository = createPostgresChatRepository(db);
  const service = createProductionChatService(repository, {
    getContext: async () => context,
  });
  const cases = buildRouteCases();
  const results = [];

  for (const routeCase of cases) {
    if (routeCase.mutateBefore === "remove_okf_embeddings") {
      await removeOkfEmbeddings(bundle.id, workspaceId);
    }

    const session = await service.createSession(bundle.id, `Route eval: ${routeCase.id}`);
    const sent = await service.sendMessage(session.id, routeCase.query);
    const persisted = await db.chatMessage.findUnique({
      select: { citations: true, content: true, trace: true },
      where: { id: sent.assistantMessage.id },
    });
    if (!persisted?.trace) throw new Error(`route_eval_trace_missing:${routeCase.id}`);
    const turn: PersistedTurn = {
      assistantContent: persisted.content,
      citations: persisted.citations as unknown as ChatCitation[],
      trace: persisted.trace as unknown as Stage6aRouterTrace,
    };
    const assertionErrors = [
      ...routeCase.verify(turn),
      ...assertRetractedConceptAbsent(turn),
    ];
    const foundTargets = routeCase.expectedCitationTargets.filter((target) =>
      citationTargetExists(turn.citations, target),
    );
    if (foundTargets.length < routeCase.expectedCitationTargets.length) {
      assertionErrors.push(
        `expected_citations_missing:${routeCase.expectedCitationTargets
          .filter((target) => !foundTargets.includes(target))
          .join(",")}`,
      );
    }
    results.push({
      assertionErrors,
      citations: turn.citations.map((citation) => ({
        documentTitle: citation.documentTitle,
        okfEvidenceMode: citation.okfEvidenceMode ?? null,
        okfFilePath: citation.okfFilePath ?? null,
        pageEnd: citation.pageEnd,
        pageStart: citation.pageStart,
        sourceType: citation.sourceType,
      })),
      correctCitationCount: foundTargets.length,
      expectedCitationCount: routeCase.expectedCitationTargets.length,
      id: routeCase.id,
      passed: assertionErrors.length === 0,
      query: routeCase.query,
      trace: summarizeTrace(turn.trace),
    });
  }

  const baseline = input.baselinePath
    ? JSON.parse(await readFile(input.baselinePath, "utf8")) as RouteCoverageReport
    : null;
  for (const result of results) {
    const previous = baseline?.questions.find((question) => question.id === result.id);
    if (previous && result.correctCitationCount < previous.correctCitationCount) {
      result.assertionErrors.push(
        `citation_regression:${previous.correctCitationCount}->${result.correctCitationCount}`,
      );
      result.passed = false;
    }
  }
  const report = {
    bundleId: bundle.id,
    evaluatedAt: new Date().toISOString(),
    failedCount: results.filter((result) => !result.passed).length,
    passedCount: results.filter((result) => result.passed).length,
    phase: input.phase,
    questions: results,
    workspaceId,
  } satisfies RouteCoverageReport;
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  console.log(`ROUTE_COVERAGE_EVAL_JSON=${JSON.stringify(report)}`);
  if (input.outputPath) await writeFile(input.outputPath, serialized, "utf8");
  if (report.failedCount > 0) process.exitCode = 1;
  await db.$disconnect();
  return report;
}

type RouteCoverageReport = {
  bundleId: string;
  evaluatedAt: string;
  failedCount: number;
  passedCount: number;
  phase: string;
  questions: Array<{
    assertionErrors: string[];
    correctCitationCount: number;
    expectedCitationCount: number;
    id: string;
    passed: boolean;
  }>;
  workspaceId: string;
};

async function resolveEvalWorkspace() {
  const db = getPrisma();
  const requestedId = process.env.EVAL_WORKSPACE_ID?.trim();
  let workspace = requestedId
    ? await db.workspace.findUnique({ where: { id: requestedId } })
    : await db.workspace.findFirst({
        orderBy: { createdAt: "asc" },
        where: { llmSetting: { is: { encryptedApiKey: { not: null } } } },
      });
  if (!workspace && process.env.EVAL_LLM_API_KEY?.trim()) {
    workspace = await db.workspace.upsert({
      create: { id: requestedId ?? "route_coverage_eval_workspace", name: "Route Coverage Evaluation" },
      update: {},
      where: { id: requestedId ?? "route_coverage_eval_workspace" },
    });
  }
  if (!workspace) throw new Error("route_eval_workspace_with_llm_key_required");
  if (process.env.EVAL_LLM_API_KEY?.trim()) {
    await saveWorkspaceLlmApiKey(workspace.id, "openai", process.env.EVAL_LLM_API_KEY, {
      updatedBy: EVAL_USER_ID,
    });
  }
  const configuredKey = await getWorkspaceLlmApiKeyForEnrichment(workspace.id);
  if (!configuredKey) throw new Error("route_eval_workspace_llm_key_required");
  return workspace.id;
}

async function seedBundle(context: { role: "admin"; userId: string; workspaceId: string }) {
  const db = getPrisma();
  const existing = await db.knowledgeBundle.findUnique({
    where: { workspaceId_slug: { slug: BUNDLE_SLUG, workspaceId: context.workspaceId } },
  });
  let bundleId = existing?.id;
  if (!bundleId) {
    const created = await createKnowledgeBundle({
      context,
      description: "Deterministic route-coverage evaluation fixtures.",
      name: BUNDLE_NAME,
      templateId: "generic",
    });
    bundleId = created.id;
  } else {
    await scaffoldKnowledgeBundle({
      bundleId,
      profile: GENERIC_PROFILE_TEMPLATE,
      workspaceId: context.workspaceId,
    });
  }
  await writeWorkspaceVault(context.workspaceId);
  return { id: bundleId };
}

async function seedConcepts(input: { bundleId: string; workspaceId: string }) {
  const db = getPrisma();
  const root = resolveKnowledgeBundleRoot({
    bundleId: input.bundleId,
    workspaceId: input.workspaceId,
  });
  const markdownByPath = new Map<string, string>([
    [ACTIVE_FILES.thermal, buildThermalConcept()],
    [ACTIVE_FILES.graphTarget, buildPowerBalanceConcept()],
    [ACTIVE_FILES.audit, buildAuditConcept()],
    [RETRACTED_FILE, buildRetractedConcept()],
  ]);
  for (const [filePath, markdown] of markdownByPath) {
    const fullPath = path.join(root, ...filePath.split("/"));
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, markdown, "utf8");
  }
  await writeFile(
    path.join(root, "index.md"),
    [
      "# Route Coverage Evaluation",
      "",
      ...[...markdownByPath.keys()].map((filePath) => `- [${filePath}](${filePath})`),
      "",
    ].join("\n"),
    "utf8",
  );
  await db.okfConceptLifecycle.deleteMany({
    where: {
      filePath: { in: Object.values(ACTIVE_FILES) },
      knowledgeBundleId: input.bundleId,
      workspaceId: input.workspaceId,
    },
  });
  await db.okfConceptLifecycle.upsert({
    create: {
      changedBy: EVAL_USER_ID,
      filePath: RETRACTED_FILE,
      knowledgeBundleId: input.bundleId,
      reason: "Seeded negative-control concept.",
      status: "retracted",
      workspaceId: input.workspaceId,
    },
    update: {
      changedBy: EVAL_USER_ID,
      reason: "Seeded negative-control concept.",
      status: "retracted",
    },
    where: {
      knowledgeBundleId_filePath: {
        filePath: RETRACTED_FILE,
        knowledgeBundleId: input.bundleId,
      },
    },
  });
  const embeddings = createOkfConceptEmbeddingRepository(db);
  for (const [filePath, markdown] of markdownByPath) {
    await embeddings.deleteForFile({
      filePath,
      knowledgeBundleId: input.bundleId,
      workspaceId: input.workspaceId,
    });
    if (filePath !== RETRACTED_FILE) {
      await queueOkfConceptEmbedding({
        bundleName: BUNDLE_NAME,
        filePath,
        knowledgeBundleId: input.bundleId,
        markdown,
        workspaceId: input.workspaceId,
      });
    }
  }
  await waitForOkfEmbeddings({ ...input, expected: Object.values(ACTIVE_FILES).length });
}

async function seedRagDocument(input: { bundleId: string; workspaceId: string }) {
  const db = getPrisma();
  await db.document.deleteMany({ where: { id: DOCUMENT_ID, workspaceId: input.workspaceId } });
  await db.document.create({
    data: {
      description: "Unreviewed discovery-only route evaluation source.",
      fileType: "PDF",
      id: DOCUMENT_ID,
      knowledgeBundleId: input.bundleId,
      mimeType: "application/pdf",
      owner: "Route Eval",
      pages: 2,
      ragStatus: "not_indexed",
      size: "2 KB",
      sizeBytes: 2048,
      sourceType: "PDF",
      status: "ready",
      tags: ["evaluation", "raw"],
      title: RAW_DOCUMENT_TITLE,
      updatedLabel: "Now",
      workspaceId: input.workspaceId,
    },
  });
  await db.extractedPage.createMany({
    data: [
      {
        charCount: 369,
        documentId: DOCUMENT_ID,
        imageCount: 0,
        pageNumber: 1,
        tables: [],
        text: "Calibration Drift Field Notes\n\nTechnicians observed calibration drift after repeated thermal cycles. The raw log recommends comparing sensor offsets across test runs and inspecting connector resistance before replacing instrumentation.",
        workspaceId: input.workspaceId,
      },
      {
        charCount: 360,
        documentId: DOCUMENT_ID,
        imageCount: 0,
        pageNumber: 2,
        tables: [],
        text: "Unreviewed Heat Removal Observation\n\nExcess heat was removed from orbital test equipment by increasing coolant flow and checking radiator bypass position. This is an unreviewed field observation, not an approved operating instruction.",
        workspaceId: input.workspaceId,
      },
    ],
  });
  const repository = createRagRepository(db);
  const job = await repository.createIndexJob({
    documentId: DOCUMENT_ID,
    workspaceId: input.workspaceId,
  });
  await runRagIndexJob(
    {
      chunkingStrategyId: "paragraph-context-v2",
      documentId: DOCUMENT_ID,
      indexJobId: job.id,
      indexVersion: job.indexVersion,
      mode: "initial",
      workspaceId: input.workspaceId,
    },
    { embeddingProvider: getEmbeddingProvider(), repository },
  );
}

async function waitForOkfEmbeddings(input: {
  bundleId: string;
  expected: number;
  workspaceId: string;
}) {
  const db = getPrisma();
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const count = await db.okfConceptEmbedding.count({
      where: { knowledgeBundleId: input.bundleId, workspaceId: input.workspaceId },
    });
    if (count === input.expected) return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("route_eval_okf_embedding_timeout");
}

async function removeOkfEmbeddings(bundleId: string, workspaceId: string) {
  const db = getPrisma();
  await db.$transaction([
    db.okfConceptEmbedding.deleteMany({ where: { knowledgeBundleId: bundleId, workspaceId } }),
    db.okfConceptEmbeddingJob.deleteMany({ where: { knowledgeBundleId: bundleId, workspaceId } }),
  ]);
}

function buildRouteCases(): RouteCase[] {
  return [
    {
      expectedCitationTargets: [ACTIVE_FILES.thermal],
      id: "okf-lexical",
      query: "What is the approved Thermal Regulation Protocol?",
      verify: (turn) => [
        ...expectEqual(turn.trace.route, "okf_only", "route"),
        ...expectEqual(turn.trace.okfMatchMode, "lexical", "okfMatchMode"),
        ...expectEqual(turn.trace.rerank?.status, "not_applicable", "rerank.status"),
        ...expectEqual(turn.trace.queryUnderstanding?.rewriteMode, "not_needed", "queryUnderstanding.rewriteMode"),
      ],
    },
    {
      expectedCitationTargets: [ACTIVE_FILES.thermal],
      id: "okf-vector-fallback",
      query: "What is the authoritative way to remove excess heat from orbital test equipment by increasing coolant flow through the primary radiator loop and verifying bypass position before changing the pump setting?",
      verify: (turn) => [
        ...expectEqual(turn.trace.route, "okf_only", "route"),
        ...expectEqual(turn.trace.okfMatchMode, "vector", "okfMatchMode"),
        ...expectEqual(turn.trace.rerank?.status, "not_applicable", "rerank.status"),
      ],
    },
    {
      expectedCitationTargets: [ACTIVE_FILES.thermal, ACTIVE_FILES.graphTarget],
      id: "okf-graph-traversal",
      query: "How does the approved Thermal Regulation Protocol affect the downstream subsystem?",
      verify: (turn) => [
        ...expectEqual(turn.trace.route, "okf_only", "route"),
        ...expectEqual(turn.trace.requiresGraphTraversal, true, "requiresGraphTraversal"),
        ...expectEqual(turn.trace.okfEvidenceMode, "graph", "okfEvidenceMode"),
        ...expectEqual(turn.trace.rerank?.status, "not_applicable", "rerank.status"),
      ],
    },
    {
      expectedCitationTargets: [RAW_DOCUMENT_TITLE],
      id: "rag-only",
      query: "Search every document for calibration drift examples.",
      verify: (turn) => [
        ...expectEqual(turn.trace.route, "rag_only", "route"),
        ...expectEqual(turn.trace.ragUsedForDiscoveryOnly, true, "ragUsedForDiscoveryOnly"),
        ...expectEqual(turn.trace.rerank?.applied, true, "rerank.applied"),
        ...expectEqual(turn.trace.queryUnderstanding?.rewriteMode, "not_needed", "queryUnderstanding.rewriteMode"),
        ...(turn.trace.retrievalToolsCalled.includes("okf_retrieval") ? ["okf_retriever_was_called"] : []),
        ...(turn.citations.some((citation) => citation.sourceType === "okf") ? ["unexpected_okf_citation"] : []),
      ],
    },
    {
      expectedCitationTargets: [ACTIVE_FILES.thermal, RAW_DOCUMENT_TITLE],
      id: "hybrid",
      query: "Give the approved Thermal Regulation Protocol with supporting raw documents about calibration drift.",
      verify: (turn) => [
        ...expectEqual(turn.trace.route, "hybrid", "route"),
        ...expectEqual(turn.trace.rerank?.applied, true, "rerank.applied"),
        ...(turn.citations[0]?.sourceType !== "okf" ? ["okf_evidence_not_first"] : []),
        ...(!turn.citations.some((citation) => citation.sourceType === "rag") ? ["rag_support_missing"] : []),
      ],
    },
    {
      expectedCitationTargets: [],
      id: "missing-context",
      query: "Should I delete production data?",
      verify: (turn) => [
        ...expectEqual(turn.trace.route, "missing_context", "route"),
        ...expectEqual(turn.trace.rerank?.status, "not_applicable", "rerank.status"),
        ...(turn.citations.length > 0 ? ["clarification_has_citations"] : []),
        ...(!turn.assistantContent.trim() ? ["clarification_missing"] : []),
      ],
    },
    {
      expectedCitationTargets: [],
      id: "unsupported-live-data",
      query: "What is the live weather right now?",
      verify: (turn) => [
        ...expectEqual(turn.trace.route, "unsupported", "route"),
        ...expectEqual(turn.trace.rerank?.status, "not_applicable", "rerank.status"),
        ...expectEqual(turn.trace.queryUnderstanding?.rewriteMode, "not_needed", "queryUnderstanding.rewriteMode"),
        ...(turn.citations.length > 0 ? ["unsupported_has_citations"] : []),
      ],
    },
    {
      expectedCitationTargets: [RAW_DOCUMENT_TITLE],
      id: "okf-vector-missing-fallback",
      mutateBefore: "remove_okf_embeddings",
      query: "What is the authoritative way to remove excess heat from orbital test equipment by increasing coolant flow through the primary radiator loop and verifying bypass position before changing the pump setting?",
      verify: (turn) => [
        ...expectEqual(turn.trace.route, "okf_only", "route"),
        ...expectEqual(turn.trace.ragUsedForDiscoveryOnly, true, "ragUsedForDiscoveryOnly"),
        ...(turn.trace.okfMatchMode ? [`unexpected_okf_match_mode:${turn.trace.okfMatchMode}`] : []),
        ...(turn.citations.some((citation) => citation.sourceType === "okf") ? ["unexpected_okf_citation"] : []),
      ],
    },
  ];
}

function summarizeTrace(trace: Stage6aRouterTrace) {
  return {
    finalEvidenceStatus: trace.finalEvidenceStatus ?? null,
    okfEvidenceMode: trace.okfEvidenceMode ?? null,
    okfMatchMode: trace.okfMatchMode ?? null,
    queryUnderstanding: trace.queryUnderstanding
      ? { rewriteMode: trace.queryUnderstanding.rewriteMode, warnings: trace.queryUnderstanding.warnings }
      : null,
    ragUsedForDiscoveryOnly: trace.ragUsedForDiscoveryOnly ?? false,
    rerank: trace.rerank ?? null,
    requiresGraphTraversal: trace.requiresGraphTraversal ?? false,
    retrievalToolsCalled: trace.retrievalToolsCalled,
    route: trace.route,
  };
}

function citationTargetExists(citations: ChatCitation[], target: string) {
  return citations.some((citation) =>
    target.endsWith(".md")
      ? citation.okfFilePath === target
      : citation.documentTitle === target,
  );
}

function assertRetractedConceptAbsent(turn: PersistedTurn) {
  return turn.citations.some((citation) => citation.okfFilePath === RETRACTED_FILE)
    ? ["retracted_concept_cited"]
    : [];
}

function expectEqual(actual: unknown, expected: unknown, field: string) {
  return actual === expected ? [] : [`${field}:${String(actual)}!=${String(expected)}`];
}

function buildThermalConcept() {
  return `---
type: procedure
title: Thermal Regulation Protocol
description: Approved control process for the Helios coolant circuit.
tags:
  - thermal
  - helios
updated: 2026-07-19
review_status: approved
source_file: Helios Operations Handbook.pdf
source_pages:
  - 12
  - 13
source_authority: Helios Engineering
relations:
  - relation: routes_to
    target: power-balance-guard.md
    target_type: procedure
    reason: Thermal control routes to the downstream power-balancing safeguard.
---

# Thermal Regulation Protocol

Remove excess heat from orbital test equipment by increasing coolant flow through the primary radiator loop. Verify bypass position before changing the pump setting.
`;
}

function buildPowerBalanceConcept() {
  return `---
type: procedure
title: Power Balance Guard
description: Protects the downstream power stage during coolant-demand changes.
tags:
  - power
  - safeguard
updated: 2026-07-19
review_status: approved
source_file: Helios Power Controls.pdf
source_pages:
  - 44
source_authority: Helios Engineering
---

# Power Balance Guard

When coolant demand changes, hold the downstream converter within its approved load envelope and verify bus stability before continuing.
`;
}

function buildAuditConcept() {
  return `---
type: policy
title: Audit Retention Standard
description: Defines retention of approved operational audit records.
tags:
  - audit
  - records
updated: 2026-07-19
review_status: approved
source_file: Records Governance Standard.pdf
source_pages:
  - 5
source_authority: Records Office
---

# Audit Retention Standard

Retain approved operational audit records for seven years unless a longer legal hold applies.
`;
}

function buildRetractedConcept() {
  return `---
type: procedure
title: Retired Thermal Regulation Protocol
description: Obsolete heat-control instructions retained only as a negative control.
tags:
  - thermal
  - retired
updated: 2026-07-19
review_status: approved
source_file: Retired Helios Handbook.pdf
source_pages:
  - 99
source_authority: Retired Archive
---

# Retired Thermal Regulation Protocol

This obsolete concept must never appear in current evidence.
`;
}

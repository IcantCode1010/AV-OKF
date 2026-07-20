import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
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
import { getChatCitationHref } from "../src/lib/chat-citation-links.ts";
import { parseCitationMarkers } from "../src/lib/chat-citation-markers.ts";
import { markOkfConceptLifecycle } from "../src/lib/okf-lifecycle.ts";
import {
  buildDocumentObjectKey,
  getObjectStorage,
} from "../src/lib/production-storage.ts";
import {
  getWorkspaceLlmApiKeyForEnrichment,
  saveWorkspaceLlmApiKey,
} from "../src/lib/llm-provider-settings.ts";

const EVAL_USER_ID = "e2e-route-coverage";
const BUNDLE_NAME = "Route Coverage Evaluation";
const BUNDLE_SLUG = "route-coverage-evaluation";
const DOCUMENT_ID = "route_coverage_eval_document_v1";
const FOREIGN_DOCUMENT_ID = "route_coverage_eval_foreign_document_v1";
const FOREIGN_WORKSPACE_ID = "route_coverage_eval_foreign_workspace_v1";
const RAW_DOCUMENT_TITLE = "Route Coverage Raw Operations Log";
const EVAL_PDF_BYTES = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n",
  "utf8",
);
const ACTIVE_FILES = {
  audit: "concepts/policy/audit-retention-standard.md",
  graphTarget: "concepts/procedure/power-balance-guard.md",
  thermal: "concepts/procedure/thermal-regulation-protocol.md",
} as const;
const WEAK_FILES = {
  automobile: "concepts/procedure/facility-surface-assessment.md",
  forklift: "concepts/procedure/operational-surface-preparation.md",
} as const;
const RETRACTED_FILE = "concepts/procedure/retired-thermal-regulation.md";

type RouteCase = {
  expectedCitationTargets: string[];
  followUp?: {
    content: string;
    selectionValues: Record<string, string>;
    withdrawWeakCandidates?: boolean;
  };
  id: string;
  initialVerify?: (input: PersistedTurn) => string[];
  mutateBefore?: "remove_okf_embeddings" | "remove_weak_okf_embeddings";
  preUseClarificationRound?: boolean;
  query: string;
  verify(input: PersistedTurn): string[];
};

type PersistedTurn = {
  assistantContent: string;
  citations: ChatCitation[];
  trace: Stage6aRouterTrace;
};

type Stage7cScenarioResult = {
  assertionErrors: string[];
  id: string;
  passed: boolean;
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
    } else if (routeCase.mutateBefore === "remove_weak_okf_embeddings") {
      await removeWeakOkfEmbeddings(bundle.id, workspaceId);
    }

    const session = await service.createSession(bundle.id, `Route eval: ${routeCase.id}`);
    if (routeCase.preUseClarificationRound) {
      await service.sendMessage(session.id, "Should I delete production data?");
    }
    const firstSent = await service.sendMessage(session.id, routeCase.query);
    const firstPersisted = await db.chatMessage.findUnique({
      select: { citations: true, content: true, trace: true },
      where: { id: firstSent.assistantMessage.id },
    });
    if (!firstPersisted?.trace) throw new Error(`route_eval_trace_missing:${routeCase.id}`);
    const firstTurn: PersistedTurn = {
      assistantContent: firstPersisted.content,
      citations: firstPersisted.citations as unknown as ChatCitation[],
      trace: firstPersisted.trace as unknown as Stage6aRouterTrace,
    };
    const initialAssertionErrors = routeCase.initialVerify?.(firstTurn) ?? [];
    let turn = firstTurn;
    if (routeCase.followUp) {
      const clarification = firstTurn.trace.metadataClarification;
      if (!clarification) {
        initialAssertionErrors.push("metadata_clarification_missing");
      } else {
        if (routeCase.followUp.withdrawWeakCandidates) {
          await withdrawWeakCandidates(bundle.id, workspaceId);
        }
        const selection = clarification.fields.map((field) => ({
          field: field.field,
          label: field.label,
          value: routeCase.followUp?.selectionValues[field.field] ?? field.options[0] ?? "",
        }));
        const followed = await service.sendMessage(
          session.id,
          routeCase.followUp.content,
          selection,
        );
        const persistedFollowUp = await db.chatMessage.findUnique({
          select: { citations: true, content: true, trace: true },
          where: { id: followed.assistantMessage.id },
        });
        if (!persistedFollowUp?.trace) {
          throw new Error(`route_eval_follow_up_trace_missing:${routeCase.id}`);
        }
        turn = {
          assistantContent: persistedFollowUp.content,
          citations: persistedFollowUp.citations as unknown as ChatCitation[],
          trace: persistedFollowUp.trace as unknown as Stage6aRouterTrace,
        };
      }
    }
    const assertionErrors = [
      ...initialAssertionErrors,
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
      ...(routeCase.followUp ? { initialTrace: summarizeTrace(firstTurn.trace) } : {}),
      trace: summarizeTrace(turn.trace),
    });
  }

  // Route cases intentionally mutate embeddings and lifecycle fixtures. Reset
  // them before Stage 7C probes so every scenario begins from a known state.
  await seedRagDocument({ bundleId: bundle.id, workspaceId });
  await seedConcepts({ bundleId: bundle.id, workspaceId });
  const stage7cScenarios = await runStage7cScenarios({
    bundleId: bundle.id,
    context,
    service,
    workspaceId,
  });

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
    failedCount:
      results.filter((result) => !result.passed).length +
      stage7cScenarios.filter((result) => !result.passed).length,
    passedCount:
      results.filter((result) => result.passed).length +
      stage7cScenarios.filter((result) => result.passed).length,
    phase: input.phase,
    questions: results,
    stage7cScenarios,
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
  stage7cScenarios: Stage7cScenarioResult[];
  workspaceId: string;
};

async function resolveEvalWorkspace() {
  const db = getPrisma();
  const requestedId = process.env.EVAL_WORKSPACE_ID?.trim();
  const testAuthEmail = getTestAuthEmail();
  const testAuthUser = await db.user.findUnique({
    include: { memberships: { orderBy: { createdAt: "asc" }, take: 1 } },
    where: { email: testAuthEmail },
  });
  const testAuthWorkspaceId = testAuthUser?.memberships[0]?.workspaceId;
  let workspace = requestedId
    ? await db.workspace.findUnique({ where: { id: requestedId } })
    : testAuthWorkspaceId
      ? await db.workspace.findUnique({ where: { id: testAuthWorkspaceId } })
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
  await ensureTestAuthWorkspace(workspace.id);
  return workspace.id;
}

async function ensureTestAuthWorkspace(workspaceId: string) {
  const db = getPrisma();
  const user = await db.user.upsert({
    create: { email: getTestAuthEmail(), name: "Route Coverage Test User" },
    update: {},
    where: { email: getTestAuthEmail() },
  });
  const firstMembership = await db.workspaceMember.findFirst({
    orderBy: { createdAt: "asc" },
    where: { userId: user.id },
  });

  if (firstMembership && firstMembership.workspaceId !== workspaceId) {
    throw new Error(
      `route_eval_test_auth_workspace_mismatch:${firstMembership.workspaceId}:${workspaceId}`,
    );
  }
  if (!firstMembership) {
    await db.workspaceMember.create({
      data: { role: "admin", userId: user.id, workspaceId },
    });
  }
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
    [WEAK_FILES.forklift, buildForkliftSurfaceConcept()],
    [WEAK_FILES.automobile, buildAutomobileSurfaceConcept()],
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
      filePath: { in: [...Object.values(ACTIVE_FILES), ...Object.values(WEAK_FILES)] },
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
  await waitForOkfEmbeddings({
    ...input,
    expected: Object.values(ACTIVE_FILES).length + Object.values(WEAK_FILES).length,
  });
}

async function seedRagDocument(input: { bundleId: string; workspaceId: string }) {
  const db = getPrisma();
  const objectKey = buildDocumentObjectKey({
    documentId: DOCUMENT_ID,
    objectId: "route_coverage_eval",
    workspaceId: input.workspaceId,
  });
  await getObjectStorage().putObject({
    body: EVAL_PDF_BYTES,
    contentType: "application/pdf",
    key: objectKey,
  });
  await db.document.deleteMany({ where: { id: DOCUMENT_ID, workspaceId: input.workspaceId } });
  await db.document.create({
    data: {
      description: "Unreviewed discovery-only route evaluation source.",
      extractedPages: {
        create: [
          {
            charCount: 369,
            imageCount: 0,
            pageNumber: 1,
            tables: [],
            text: "Calibration Drift Field Notes\n\nTechnicians observed calibration drift after repeated thermal cycles. The raw log recommends comparing sensor offsets across test runs and inspecting connector resistance before replacing instrumentation.",
            workspaceId: input.workspaceId,
          },
          {
            charCount: 360,
            imageCount: 0,
            pageNumber: 2,
            tables: [],
            text: "Unreviewed Heat Removal Observation\n\nExcess heat was removed from orbital test equipment by increasing coolant flow and checking radiator bypass position. This is an unreviewed field observation, not an approved operating instruction.",
            workspaceId: input.workspaceId,
          },
          {
            charCount: 326,
            imageCount: 0,
            pageNumber: 3,
            tables: [],
            text: "Ground Leveling Field Note\n\nFor the forklift operations manual, ground leveling means confirming the travel surface is level, stable, and free of unsupported edges before moving or lifting a load. This raw note is discovery evidence and requires review against approved guidance.",
            workspaceId: input.workspaceId,
          },
        ],
      },
      fileType: "PDF",
      id: DOCUMENT_ID,
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
      originalFilename: "route-coverage-evaluation.pdf",
      owner: "Route Eval",
      pages: 3,
      ragStatus: "not_indexed",
      size: `${EVAL_PDF_BYTES.length} B`,
      sizeBytes: EVAL_PDF_BYTES.length,
      sourceType: "PDF",
      status: "ready",
      tags: ["evaluation", "raw"],
      title: RAW_DOCUMENT_TITLE,
      updatedLabel: "Now",
      workspaceId: input.workspaceId,
    },
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

async function removeWeakOkfEmbeddings(bundleId: string, workspaceId: string) {
  const db = getPrisma();
  await db.$transaction([
    db.okfConceptEmbedding.deleteMany({
      where: {
        filePath: { in: Object.values(WEAK_FILES) },
        knowledgeBundleId: bundleId,
        workspaceId,
      },
    }),
    db.okfConceptEmbeddingJob.deleteMany({
      where: {
        filePath: { in: Object.values(WEAK_FILES) },
        knowledgeBundleId: bundleId,
        workspaceId,
      },
    }),
  ]);
}

async function withdrawWeakCandidates(bundleId: string, workspaceId: string) {
  const root = resolveKnowledgeBundleRoot({ bundleId, workspaceId });
  for (const filePath of Object.values(WEAK_FILES)) {
    const fullPath = path.join(root, ...filePath.split("/"));
    const markdown = await readFile(fullPath, "utf8");
    await writeFile(
      fullPath,
      markdown.replace("review_status: approved", "review_status: needs_review"),
      "utf8",
    );
  }
}

async function runStage7cScenarios(input: {
  bundleId: string;
  context: { role: "admin"; userId: string; workspaceId: string };
  service: ReturnType<typeof createProductionChatService>;
  workspaceId: string;
}): Promise<Stage7cScenarioResult[]> {
  const db = getPrisma();
  const results: Stage7cScenarioResult[] = [];
  const record = async (id: string, verify: () => Promise<string[]>) => {
    try {
      const assertionErrors = await verify();
      results.push({ assertionErrors, id, passed: assertionErrors.length === 0 });
    } catch (error) {
      results.push({
        assertionErrors: [`exception:${formatError(error)}`],
        id,
        passed: false,
      });
    }
  };

  await seedForeignPdfDocument();
  const auth = await createTestAuthClient();
  const crossWorkspace = await snapshotHttpResponse(
    await auth.request(`/api/documents/${FOREIGN_DOCUMENT_ID}/file`),
  );
  const nonexistent = await snapshotHttpResponse(
    await auth.request(`/api/documents/${randomUUID()}/file`),
  );

  await record("stage7c-pdf-cross-workspace", async () => [
    ...expectEqual(crossWorkspace.status, 404, "status"),
    ...expectEqual(crossWorkspace.body, nonexistent.body, "body_matches_nonexistent"),
    ...expectEqual(
      JSON.stringify(crossWorkspace.headers),
      JSON.stringify(nonexistent.headers),
      "headers_match_nonexistent",
    ),
  ]);
  await record("stage7c-pdf-nonexistent", async () => [
    ...expectEqual(nonexistent.status, 404, "status"),
    ...expectEqual(nonexistent.body, "Document not found", "body"),
  ]);
  await record("stage7c-pdf-own-document", async () => {
    const response = await auth.request(`/api/documents/${DOCUMENT_ID}/file`);
    const bytes = Buffer.from(await response.arrayBuffer());
    return [
      ...expectEqual(response.status, 200, "status"),
      ...expectEqual(response.headers.get("content-type"), "application/pdf", "content-type"),
      ...(response.headers.get("content-disposition")?.startsWith("inline")
        ? []
        : [`content-disposition:${response.headers.get("content-disposition")}`]),
      ...expectEqual(response.headers.get("cache-control"), "private, no-store", "cache-control"),
      ...expectEqual(bytes.length, EVAL_PDF_BYTES.length, "byte_length"),
      ...expectEqual(bytes.equals(EVAL_PDF_BYTES), true, "bytes_match"),
    ];
  });
  await record("stage7c-pdf-unauthenticated", async () => {
    const response = await fetch(
      `${getEvalAppBaseUrl()}/api/documents/${DOCUMENT_ID}/file`,
      { redirect: "manual" },
    );
    return [...expectEqual(response.status, 401, "status")];
  });

  const zeroEvidence = await runGapQuestion(input, {
    id: "zero-evidence",
    question: "Search every document for zephyr quasar protocol 9917.",
  });
  await record("stage7c-gap-zero-evidence", async () => [
    ...expectEqual(zeroEvidence.gaps.length, 1, "gap_count"),
    ...expectEqual(zeroEvidence.gaps[0]?.question, zeroEvidence.question, "question"),
    ...expectEqual(zeroEvidence.gaps[0]?.route, zeroEvidence.turn.trace.route, "route"),
    ...expectEqual(
      zeroEvidence.gaps[0]?.finalEvidenceStatus,
      zeroEvidence.turn.trace.finalEvidenceStatus,
      "finalEvidenceStatus",
    ),
  ]);
  await record("stage7c-honest-miss-content", async () => {
    const summary = zeroEvidence.turn.trace.searchSummary;
    const citationMarkers = parseCitationMarkers(zeroEvidence.turn.assistantContent).filter(
      (segment) => segment.type === "citation",
    );
    return [
      ...(summary ? [] : ["searchSummary:missing"]),
      ...expectEqual(summary?.approvedKnowledgeMatches, 0, "approvedKnowledgeMatches"),
      ...(Number(summary?.bundlesSearched ?? 0) > 0 ? [] : ["bundlesSearched:not_positive"]),
      ...(Number(summary?.indexedDocumentsSearched ?? 0) > 0
        ? []
        : ["indexedDocumentsSearched:not_positive"]),
      ...(zeroEvidence.turn.assistantContent.includes(
        `${summary?.bundlesSearched} active knowledge bundle`,
      )
        ? []
        : ["response_missing_bundle_count"]),
      ...(zeroEvidence.turn.assistantContent.includes(
        `${summary?.indexedDocumentsSearched} indexed document`,
      )
        ? []
        : ["response_missing_document_count"]),
      ...(/rephrase|add and review a source/i.test(zeroEvidence.turn.assistantContent)
        ? []
        : ["response_missing_next_step"]),
      ...expectEqual(citationMarkers.length, 0, "citation_marker_count"),
    ];
  });

  await record("stage7c-gap-clarification-resolved", async () => {
    await seedConcepts({ bundleId: input.bundleId, workspaceId: input.workspaceId });
    const session = await input.service.createSession(
      input.bundleId,
      "Stage 7C resolved clarification",
    );
    const first = await input.service.sendMessage(session.id, "What does ground leveling mean?");
    const firstTrace = first.assistantMessage.trace as Stage6aRouterTrace | undefined;
    const clarification = firstTrace?.metadataClarification;
    if (!clarification) return ["metadataClarification:missing"];
    const selection = clarification.fields.map((field) => ({
      field: field.field,
      label: field.label,
      value:
        ({ document_type: "Operations Manual", subject_family: "Forklift" } as Record<string, string>)[field.field] ??
        field.options[0] ??
        "",
    }));
    const followUp = await input.service.sendMessage(
      session.id,
      "Forklift, Operations Manual",
      selection,
    );
    const gapCount = await db.knowledgeGap.count({ where: { chatSessionId: session.id } });
    return [
      ...expectEqual(gapCount, 0, "gap_count"),
      ...(followUp.assistantMessage.citations.length > 0
        ? []
        : ["follow_up_citations:missing"]),
    ];
  });

  const ragFound = await runGapQuestion(input, {
    id: "rag-found",
    question: "Search every document for calibration drift examples.",
  });
  await record("stage7c-gap-rag-found", async () => [
    ...expectEqual(ragFound.gaps.length, 0, "gap_count"),
    ...(ragFound.turn.citations.some((citation) => citation.sourceType === "rag")
      ? []
      : ["rag_citation:missing"]),
  ]);

  const fallbackMiss = await runGapQuestion(input, {
    id: "fallback-miss",
    question: "What is the approved nebula orchard exception 8842 procedure?",
    preUseClarificationRound: true,
  });
  await record("stage7c-gap-rag-fallback-miss", async () => [
    ...expectEqual(fallbackMiss.gaps.length, 1, "gap_count"),
    ...expectEqual(
      fallbackMiss.gaps[0]?.finalEvidenceStatus,
      "no_evidence",
      "finalEvidenceStatus",
    ),
  ]);

  await runCitationLifecycleScenarios({ ...input, auth, record });

  // Keep the idempotent fixture ready for another evaluation run.
  await db.okfConceptLifecycle.deleteMany({
    where: {
      filePath: { in: [ACTIVE_FILES.thermal, ACTIVE_FILES.audit] },
      knowledgeBundleId: input.bundleId,
      workspaceId: input.workspaceId,
    },
  });
  await seedRagDocument({ bundleId: input.bundleId, workspaceId: input.workspaceId });
  await seedConcepts({ bundleId: input.bundleId, workspaceId: input.workspaceId });
  return results;
}

async function runCitationLifecycleScenarios(input: {
  auth: TestAuthClient;
  bundleId: string;
  context: { role: "admin"; userId: string; workspaceId: string };
  record(id: string, verify: () => Promise<string[]>): Promise<void>;
  service: ReturnType<typeof createProductionChatService>;
  workspaceId: string;
}) {
  const db = getPrisma();
  const root = resolveKnowledgeBundleRoot({
    bundleId: input.bundleId,
    workspaceId: input.workspaceId,
  });

  await input.record("stage7c-citation-retracted", async () => {
    const cited = await createCitedTurn(
      input.service,
      input.bundleId,
      "What is the approved Thermal Regulation Protocol?",
      "okf",
    );
    await markOkfConceptLifecycle({
      actorId: EVAL_USER_ID,
      filePath: ACTIVE_FILES.thermal,
      knowledgeBundleId: input.bundleId,
      knowledgeRoot: root,
      reason: "Stage 7C citation-race evaluation.",
      status: "retracted",
      workspaceId: input.workspaceId,
    });
    const citation = await reloadCitation(input.service, cited.sessionId, cited.messageId);
    const page = await input.auth.request(`/chat/${cited.sessionId}`);
    const html = await page.text();
    return [
      ...expectEqual(
        citation?.lifecycleNotice,
        "This source was retracted after this answer was generated.",
        "lifecycleNotice",
      ),
      ...expectEqual(citation ? getChatCitationHref(citation) : null, null, "citationHref"),
      ...(html.includes("This source was retracted after this answer was generated.")
        ? []
        : ["rendered_notice:missing"]),
    ];
  });

  await input.record("stage7c-citation-archived", async () => {
    const cited = await createCitedTurn(
      input.service,
      input.bundleId,
      "What is the approved Audit Retention Standard?",
      "okf",
    );
    await markOkfConceptLifecycle({
      actorId: EVAL_USER_ID,
      filePath: ACTIVE_FILES.audit,
      knowledgeBundleId: input.bundleId,
      knowledgeRoot: root,
      reason: "Stage 7C archived citation evaluation.",
      status: "archived",
      workspaceId: input.workspaceId,
    });
    const citation = await reloadCitation(input.service, cited.sessionId, cited.messageId);
    return [
      ...expectEqual(
        citation?.lifecycleNotice,
        "This source is now archived and may no longer reflect current approved knowledge.",
        "lifecycleNotice",
      ),
      ...(citation?.lifecycleNotice?.includes("retracted")
        ? ["archived_notice_uses_retracted_wording"]
        : []),
      ...expectEqual(citation ? getChatCitationHref(citation) : null, null, "citationHref"),
    ];
  });

  await input.record("stage7c-citation-deleted-document", async () => {
    const cited = await createCitedTurn(
      input.service,
      input.bundleId,
      "Search every document for calibration drift examples.",
      "rag",
    );
    const storedObject = await db.documentObject.findFirst({
      where: { documentId: DOCUMENT_ID, workspaceId: input.workspaceId },
    });
    await db.document.delete({ where: { id: DOCUMENT_ID, workspaceId: input.workspaceId } });
    if (storedObject) await getObjectStorage().deleteObject(storedObject.objectKey);
    const citation = await reloadCitation(input.service, cited.sessionId, cited.messageId);
    const response = await input.auth.request(`/api/documents/${DOCUMENT_ID}/file`);
    return [
      ...expectEqual(citation?.lifecycleNotice, "This source is no longer available.", "lifecycleNotice"),
      ...expectEqual(citation ? getChatCitationHref(citation) : null, null, "citationHref"),
      ...expectEqual(response.status, 404, "pdf_status"),
      ...expectEqual(await response.text(), "Document not found", "pdf_body"),
    ];
  });
}

async function createCitedTurn(
  service: ReturnType<typeof createProductionChatService>,
  bundleId: string,
  question: string,
  sourceType: "okf" | "rag",
) {
  const session = await service.createSession(bundleId, `Stage 7C ${sourceType} citation`);
  const sent = await service.sendMessage(session.id, question);
  if (!sent.assistantMessage.citations.some((citation) => citation.sourceType === sourceType)) {
    throw new Error(`stage7c_expected_${sourceType}_citation_missing`);
  }
  return { messageId: sent.assistantMessage.id, sessionId: session.id };
}

async function reloadCitation(
  service: ReturnType<typeof createProductionChatService>,
  sessionId: string,
  messageId: string,
) {
  const session = await service.getSessionWithMessages(sessionId);
  return session?.messages
    .find((message) => message.id === messageId)
    ?.citations[0];
}

async function runGapQuestion(
  input: {
    bundleId: string;
    service: ReturnType<typeof createProductionChatService>;
  },
  options: { id: string; preUseClarificationRound?: boolean; question: string },
) {
  const db = getPrisma();
  const session = await input.service.createSession(
    input.bundleId,
    `Stage 7C gap: ${options.id}`,
  );
  if (options.preUseClarificationRound) {
    await input.service.sendMessage(session.id, "Should I delete production data?");
  }
  const sent = await input.service.sendMessage(session.id, options.question);
  const persisted = await db.chatMessage.findUnique({
    select: { citations: true, content: true, trace: true },
    where: { id: sent.assistantMessage.id },
  });
  if (!persisted?.trace) throw new Error(`stage7c_gap_trace_missing:${options.id}`);
  return {
    gaps: await db.knowledgeGap.findMany({
      orderBy: { createdAt: "asc" },
      where: { chatSessionId: session.id },
    }),
    question: options.question,
    turn: {
      assistantContent: persisted.content,
      citations: persisted.citations as unknown as ChatCitation[],
      trace: persisted.trace as unknown as Stage6aRouterTrace,
    } satisfies PersistedTurn,
  };
}

async function seedForeignPdfDocument() {
  const db = getPrisma();
  const workspace = await db.workspace.upsert({
    create: { id: FOREIGN_WORKSPACE_ID, name: "Route Coverage Foreign Workspace" },
    update: {},
    where: { id: FOREIGN_WORKSPACE_ID },
  });
  const bundle = await db.knowledgeBundle.upsert({
    create: {
      createdBy: EVAL_USER_ID,
      description: "Cross-workspace PDF authorization fixture.",
      id: "route_coverage_eval_foreign_bundle_v1",
      name: "Foreign Route Coverage Bundle",
      slug: "foreign-route-coverage-bundle",
      workspaceId: workspace.id,
    },
    update: {},
    where: {
      workspaceId_slug: {
        slug: "foreign-route-coverage-bundle",
        workspaceId: workspace.id,
      },
    },
  });
  await db.document.deleteMany({ where: { id: FOREIGN_DOCUMENT_ID } });
  const objectKey = buildDocumentObjectKey({
    documentId: FOREIGN_DOCUMENT_ID,
    objectId: "route_coverage_foreign",
    workspaceId: workspace.id,
  });
  await getObjectStorage().putObject({
    body: EVAL_PDF_BYTES,
    contentType: "application/pdf",
    key: objectKey,
  });
  await db.document.create({
    data: {
      description: "Foreign authorization boundary fixture.",
      fileType: "PDF",
      id: FOREIGN_DOCUMENT_ID,
      knowledgeBundleId: bundle.id,
      mimeType: "application/pdf",
      objects: {
        create: {
          bucket: process.env.S3_BUCKET ?? "av-okf",
          contentType: "application/pdf",
          kind: "original_pdf",
          objectKey,
          sizeBytes: EVAL_PDF_BYTES.length,
          workspaceId: workspace.id,
        },
      },
      originalFilename: "foreign-route-coverage.pdf",
      owner: "Route Eval Foreign",
      size: `${EVAL_PDF_BYTES.length} B`,
      sizeBytes: EVAL_PDF_BYTES.length,
      sourceType: "PDF",
      status: "ready",
      tags: ["evaluation", "foreign"],
      title: "Foreign Route Coverage PDF",
      updatedLabel: "Now",
      workspaceId: workspace.id,
    },
  });
}

type TestAuthClient = {
  request(pathname: string, init?: RequestInit): Promise<Response>;
};

async function createTestAuthClient(): Promise<TestAuthClient> {
  const cookies = new Map<string, string>();
  const request = async (pathname: string, init: RequestInit = {}) => {
    const response = await fetch(`${getEvalAppBaseUrl()}${pathname}`, {
      ...init,
      headers: {
        ...(cookies.size > 0
          ? { Cookie: [...cookies.entries()].map(([key, value]) => `${key}=${value}`).join("; ") }
          : {}),
        ...Object.fromEntries(new Headers(init.headers).entries()),
      },
      redirect: init.redirect ?? "manual",
    });
    absorbResponseCookies(response.headers, cookies);
    return response;
  };
  const csrfResponse = await request("/api/auth/csrf");
  if (!csrfResponse.ok) throw new Error(`route_eval_auth_csrf_failed:${csrfResponse.status}`);
  const csrf = await csrfResponse.json() as { csrfToken?: string };
  if (!csrf.csrfToken) throw new Error("route_eval_auth_csrf_token_missing");
  const signIn = await request("/api/auth/callback/credentials?json=true", {
    body: new URLSearchParams({
      callbackUrl: `${getEvalAppBaseUrl()}/dashboard`,
      csrfToken: csrf.csrfToken,
      email: getTestAuthEmail(),
      json: "true",
      password: process.env.AV_OKF_TEST_AUTH_PASSWORD ?? "codex-local-test-password",
    }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST",
  });
  if (![200, 302].includes(signIn.status)) {
    throw new Error(`route_eval_auth_sign_in_failed:${signIn.status}:${await signIn.text()}`);
  }
  const session = await request("/api/auth/session");
  const sessionData = await session.json() as { user?: { email?: string } };
  if (sessionData.user?.email !== getTestAuthEmail()) {
    throw new Error("route_eval_auth_session_missing");
  }
  return { request };
}

function absorbResponseCookies(headers: Headers, cookies: Map<string, string>) {
  const cookieHeaders = (
    headers as Headers & { getSetCookie?: () => string[] }
  ).getSetCookie?.() ?? splitCombinedSetCookie(headers.get("set-cookie"));
  for (const header of cookieHeaders) {
    const pair = header.split(";", 1)[0];
    const separator = pair?.indexOf("=") ?? -1;
    if (!pair || separator < 1) continue;
    cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
}

function splitCombinedSetCookie(value: string | null): string[] {
  return value ? value.split(/,(?=\s*[^;,]+=)/) : [];
}

async function snapshotHttpResponse(response: Response) {
  const ignoredHeaders = new Set(["connection", "date", "keep-alive", "transfer-encoding"]);
  return {
    body: await response.text(),
    headers: [...response.headers.entries()]
      .filter(([key]) => !ignoredHeaders.has(key.toLowerCase()))
      .sort(([left], [right]) => left.localeCompare(right)),
    status: response.status,
  };
}

function getEvalAppBaseUrl() {
  return (process.env.EVAL_APP_BASE_URL ?? "http://web:3000").replace(/\/$/, "");
}

function getTestAuthEmail() {
  return (process.env.AV_OKF_TEST_AUTH_EMAIL ?? "test@av-okf.local").trim().toLowerCase();
}

function formatError(error: unknown) {
  return error instanceof Error ? `${error.name}:${error.message}` : String(error);
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
      expectedCitationTargets: [RAW_DOCUMENT_TITLE],
      followUp: {
        content: "Subject or family: Forklift; Document type: Operations Manual.",
        selectionValues: {
          document_type: "Operations Manual",
          subject_family: "Forklift",
        },
        withdrawWeakCandidates: true,
      },
      id: "metadata-weak-two-turn",
      initialVerify: (turn) => [
        ...expectEqual(turn.trace.finalEvidenceStatus, "weak_evidence", "initial.finalEvidenceStatus"),
        ...expectEqual(turn.trace.rerank?.status, "not_applicable", "initial.rerank.status"),
        ...(turn.trace.metadataClarification ? [] : ["initial.metadataClarification:missing"]),
        ...(turn.citations.length > 0 ? ["initial.weak_candidates_became_citations"] : []),
        ...(turn.trace.answerValidation ? ["initial.weak_candidates_reached_validation"] : []),
      ],
      mutateBefore: "remove_weak_okf_embeddings",
      query: "What does ground leveling mean?",
      verify: (turn) => [
        ...(turn.trace.route === "missing_context" ? ["follow_up_requested_second_clarification"] : []),
        ...(turn.trace.metadataClarification ? ["follow_up_metadata_clarification_repeated"] : []),
        ...expectEqual(turn.trace.ragUsedForDiscoveryOnly, true, "follow_up.ragUsedForDiscoveryOnly"),
        ...(!turn.trace.metadataClarificationSelection
          ? ["follow_up.metadataClarificationSelection:missing"]
          : []),
        ...(turn.citations.some((citation) => citation.sourceType === "okf")
          ? ["follow_up.unqualified_okf_citation"]
          : []),
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
      preUseClarificationRound: true,
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
    answerOutcome: trace.answerOutcome ?? null,
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
    searchSummary: trace.searchSummary ?? null,
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

function buildForkliftSurfaceConcept() {
  return `---
type: procedure
title: Operational Surface Preparation
description: Readiness checks for industrial material-handling equipment.
tags:
  - readiness
  - equipment
subject_family: Forklift
document_type: Operations Manual
updated: 2026-07-19
review_status: approved
source_file: Forklift Operations Manual.pdf
source_pages:
  - 18
source_authority: Equipment Manufacturer
---

# Operational Surface Preparation

Ground leveling means confirming the travel area is level and stable before moving or lifting a load.
`;
}

function buildAutomobileSurfaceConcept() {
  return `---
type: procedure
title: Facility Surface Assessment
description: Workshop readiness checks for passenger-vehicle service areas.
tags:
  - workshop
  - readiness
subject_family: Automobile
document_type: Service Bulletin
updated: 2026-07-19
review_status: approved
source_file: Automobile Workshop Bulletin.pdf
source_pages:
  - 4
source_authority: Vehicle Manufacturer
---

# Facility Surface Assessment

Ground leveling means confirming that the workshop service area remains within the specified floor tolerance.
`;
}

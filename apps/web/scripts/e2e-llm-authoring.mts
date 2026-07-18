import { writeFile } from "node:fs/promises";

import { getPrisma } from "../src/lib/prisma.ts";
import {
  confirmKnowledgeAuthoringCost,
  createKnowledgeAuthoringRun,
  runKnowledgeAuthoringJob,
} from "../src/lib/knowledge-authoring.ts";
import { getWorkspaceLlmSetting } from "../src/lib/llm-provider-settings.ts";

const documentId = requiredEnv("E2E_DOCUMENT_ID");
const confirmCost = process.env.E2E_CONFIRM_COST === "true";
const requireRelations = process.env.E2E_REQUIRE_RELATIONS === "true";
const reportPath = process.env.E2E_REPORT_PATH;
const db = getPrisma();

const document = await db.document.findUnique({
  select: { id: true, knowledgeBundleId: true, status: true, title: true, workspaceId: true },
  where: { id: documentId },
});
if (!document || document.status !== "ready") throw new Error("e2e_requires_ready_document");

const setting = await getWorkspaceLlmSetting(document.workspaceId);
if (!setting.hasKey) throw new Error("workspace_llm_key_not_configured");

const context = {
  role: "admin",
  userId: "e2e-real-llm",
  workspaceId: document.workspaceId,
} as const;
const run = await createKnowledgeAuthoringRun({ context, documentId });
let result = await runKnowledgeAuthoringJob({
  documentId,
  runId: run.id,
  workspaceId: document.workspaceId,
});

if (result.status === "awaiting_cost_confirmation") {
  if (!confirmCost) throw new Error("e2e_cost_confirmation_required: set E2E_CONFIRM_COST=true");
  await confirmKnowledgeAuthoringCost({ context, runId: run.id });
  result = await runKnowledgeAuthoringJob({ documentId, runId: run.id, workspaceId: document.workspaceId });
}

const completed = await db.knowledgeAuthoringRun.findUnique({
  include: {
    stageAudits: { orderBy: { createdAt: "asc" } },
  },
  where: { id: run.id },
});
if (!completed || completed.status !== "ready_for_review") {
  throw new Error(`e2e_authoring_not_ready:${completed?.status ?? "missing"}:${completed?.errorCode ?? "unknown"}`);
}

const providerAudits = completed.stageAudits.filter((audit) => audit.provider && audit.model);
if (providerAudits.length === 0) throw new Error("e2e_real_provider_audit_missing");
if (providerAudits.some((audit) => audit.provider !== setting.provider)) {
  throw new Error("e2e_provider_does_not_match_workspace_setting");
}

const topics = await db.topicRecord.findMany({
  orderBy: [{ pageStart: "asc" }, { createdAt: "asc" }],
  select: {
    confidence: true,
    enrichmentStatus: true,
    id: true,
    pageEnd: true,
    pageStart: true,
    reviewStatus: true,
    sourcePageNumbers: true,
    summary: true,
    title: true,
    topicType: true,
  },
  where: { documentId, reviewStatus: { in: ["needs_review", "needs_cleanup"] }, workspaceId: document.workspaceId },
});
const suggestions = Array.isArray(completed.relationSuggestions) ? completed.relationSuggestions : [];
if (requireRelations && suggestions.length === 0) throw new Error("e2e_relation_suggestions_required_but_missing");

const report = {
  completedAt: new Date().toISOString(),
  document: { id: document.id, title: document.title },
  provider: setting.provider,
  relationSuggestionCount: suggestions.length,
  run: {
    completedStages: completed.completedStages,
    id: completed.id,
    status: completed.status,
  },
  stageAttempts: completed.stageAudits.map((audit) => ({
    attempt: audit.attempt,
    completedAt: audit.completedAt?.toISOString() ?? null,
    errorMessage: audit.errorMessage,
    model: audit.model,
    provider: audit.provider,
    stage: audit.stage,
    startedAt: audit.startedAt.toISOString(),
    status: audit.status,
  })),
  topics,
};

const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (reportPath) await writeFile(reportPath, serialized, "utf8");
console.log(serialized);
await db.$disconnect();

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing_env_${name}`);
  return value;
}

import type { Prisma } from "@prisma/client";
import type { AuthWorkspaceContext } from "../auth-workspace.ts";
import { createPublisherApi, loadPublisherConfig } from "../efb-publisher/config.ts";
import { importEfbPackage, initializeAndUploadEfbPackage, verifyEfbRelease } from "../efb-publisher/publish-package.ts";
import type { PublisherApi } from "../efb-publisher/types.ts";
import { getPrisma } from "../prisma.ts";
import { loadProjectEfbContractRegistry, registryFingerprint } from "../project-efb-contract-registry.ts";
import { assertArticleSourcesCurrent } from "./editorial.ts";
import { currentClassification } from "./efb-classification.ts";
import { exportSelectedArticles } from "./export.ts";

export const KNOWLEDGE_RELEASE_STAGES = ["gate_selection", "classify", "compile_navigation", "build_package", "upload", "import", "verify", "activate"] as const;
export type KnowledgeReleaseStage = typeof KNOWLEDGE_RELEASE_STAGES[number];
export type ReleaseStageResult = Record<string, unknown> | void;
export type ReleaseStageHandlers = Partial<Record<KnowledgeReleaseStage, (runId: string) => Promise<ReleaseStageResult>>>;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

export function nextKnowledgeReleaseStage(completedStages: readonly string[]): KnowledgeReleaseStage | null {
  return KNOWLEDGE_RELEASE_STAGES.find((stage) => !completedStages.includes(stage)) ?? null;
}

export async function createKnowledgeReleaseRun(context: AuthWorkspaceContext, selectionIds?: string[], triggerKey?: string) {
  const db = getPrisma();
  const registry = await loadProjectEfbContractRegistry();
  const selections = await db.knowledgeEfbSelection.findMany({ where: { workspaceId: context.workspaceId, ...(selectionIds ? { id: { in: selectionIds } } : {}) }, orderBy: { articleId: "asc" } });
  if (!selections.length) throw Error("select_articles_first");
  if (selectionIds && selections.length !== new Set(selectionIds).size) throw Error("selection_scope_changed");
  for (const selection of selections) await assertApprovedSelection(context, selection.revisionId);
  if (triggerKey) {
    const existing = await db.knowledgeReleaseRun.findUnique({ where: { triggerKey } });
    if (existing) return existing;
  }
  return db.knowledgeReleaseRun.create({ data: { workspaceId: context.workspaceId, createdBy: context.userId, selectionSnapshot: json(selections), registryHash: registryFingerprint(registry), triggerKey } }).catch(async (error) => {
    if (triggerKey) {
      const raced = await db.knowledgeReleaseRun.findUnique({ where: { triggerKey } });
      if (raced) return raced;
    }
    throw error;
  });
}

export async function runKnowledgeRelease(context: AuthWorkspaceContext, runId: string, handlers: ReleaseStageHandlers) {
  const db = getPrisma();
  let run = await releaseRun(context, runId);
  if (run.status === "completed") return run;
  const claimed = await db.knowledgeReleaseRun.updateMany({ where: { id: run.id, status: { in: ["queued", "failed", "awaiting_publication", "awaiting_activation"] } }, data: { status: "running", attempts: { increment: 1 }, startedAt: run.startedAt ?? new Date(), errorCode: null, errorMessage: null } });
  if (!claimed.count) throw Error("knowledge_release_run_not_claimable");
  try {
    while (true) {
      run = await releaseRun(context, run.id);
      const stage = nextKnowledgeReleaseStage(run.completedStages);
      if (!stage) return db.knowledgeReleaseRun.update({ where: { id: run.id }, data: { status: "completed", completedAt: new Date(), currentStage: "activate" } });
      if (registryFingerprint(await loadProjectEfbContractRegistry()) !== run.registryHash) throw Error("registry_changed_during_release");
      const handler = handlers[stage];
      if (!handler && stage === "upload") return db.knowledgeReleaseRun.update({ where: { id: run.id }, data: { status: "awaiting_publication" } });
      if (!handler && stage === "activate") return db.knowledgeReleaseRun.update({ where: { id: run.id }, data: { status: "awaiting_activation" } });
      if (!handler) throw Error(`knowledge_release_stage_not_configured:${stage}`);
      const stageResult = await handler(run.id);
      const accumulated = { ...asRecord(run.result), ...(stageResult ? { [stage]: stageResult } : {}) };
      const advanced = await db.knowledgeReleaseRun.updateMany({ where: { id: run.id, status: "running", currentStage: run.currentStage }, data: { completedStages: { push: stage }, currentStage: nextKnowledgeReleaseStage([...run.completedStages, stage]) ?? stage, result: json(accumulated) } });
      if (!advanced.count) throw Error("knowledge_release_stage_race");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "knowledge_release_failed";
    await db.knowledgeReleaseRun.update({ where: { id: run.id }, data: { status: "failed", errorCode: message.split(":", 1)[0]?.slice(0, 120), errorMessage: message } });
    throw error;
  }
}

export function configuredKnowledgeReleaseHandlers(context: AuthWorkspaceContext, options: { activate?: boolean; api?: PublisherApi } = {}): ReleaseStageHandlers {
  const publishConfigured = Boolean(options.api || (process.env.EFB_PUBLISHER_URL && process.env.EFB_PUBLISHER_TOKEN));
  const api = () => options.api ?? createPublisherApi(loadPublisherConfig());
  return {
    gate_selection: async (runId) => {
      const selections = selectionSnapshot((await releaseRun(context, runId)).selectionSnapshot);
      for (const selection of selections) await assertApprovedSelection(context, selection.revisionId);
      return { selectionCount: selections.length };
    },
    classify: async (runId) => {
      const run = await releaseRun(context, runId);
      for (const selection of selectionSnapshot(run.selectionSnapshot)) {
        const metadata = asRecord(selection.metadata);
        if (metadata.selectionMode === "automatic") {
          const classification = await currentClassification(context, selection.revisionId);
          if (!classification || classification.id !== metadata.classificationId || classification.status !== "ready") throw Error("classification_changed_review_selection");
        }
      }
      return { registryHash: run.registryHash };
    },
    compile_navigation: async () => ({ profileId: requiredEnvironment("AV_OKF_NAVIGATION_PROFILE_ID"), profileVersion: Number(process.env.AV_OKF_NAVIGATION_PROFILE_VERSION ?? "1") }),
    build_package: async (runId) => {
      await exportSelectedArticles(context, undefined, undefined, runId);
      const run = await releaseRun(context, runId);
      if (!run.releaseDirectory || !run.packageId || !run.packageVersion) throw Error("knowledge_release_package_missing");
      return { releaseDirectory: run.releaseDirectory, packageId: run.packageId, packageVersion: run.packageVersion };
    },
    ...(publishConfigured ? { upload: async (runId: string) => {
      const run = await releaseRun(context, runId);
      if (!run.releaseDirectory) throw Error("knowledge_release_package_missing");
      return initializeAndUploadEfbPackage({ api: api(), packageDirectory: run.releaseDirectory, organizationId: process.env.EFB_PRIVATE_ORGANIZATION_ID });
    }, import: async (runId: string) => {
      const uploaded = asRecord(asRecord((await releaseRun(context, runId)).result).upload);
      const paths = Array.isArray(uploaded.paths) ? uploaded.paths.filter((value): value is string => typeof value === "string") : [];
      if (typeof uploaded.packageVersionId !== "string" || !paths.length) throw Error("knowledge_release_upload_result_missing");
      return importEfbPackage(api(), uploaded.packageVersionId, paths, uploaded.alreadyValidated === true);
    }, verify: async (runId: string) => {
      const imported = asRecord(asRecord((await releaseRun(context, runId)).result).import);
      if (typeof imported.packageVersionId !== "string") throw Error("knowledge_release_import_result_missing");
      const verified = await verifyEfbRelease(api(), imported.packageVersionId);
      await getPrisma().knowledgeReleaseRun.update({ where: { id: runId }, data: { receiverRevisionId: verified.revisionId } });
      return verified;
    } } : {}),
    ...(options.activate ? { activate: async (runId: string) => {
      const run = await releaseRun(context, runId);
      if (!run.receiverRevisionId) throw Error("knowledge_release_receiver_revision_missing");
      await api()({ action: "activate", revision: run.receiverRevisionId });
      return { revisionId: run.receiverRevisionId, activated: true };
    } } : {}),
  };
}

async function assertApprovedSelection(context: AuthWorkspaceContext, revisionId: string) {
  const revision = await assertArticleSourcesCurrent(context, revisionId);
  if (!revision.approval || revision.article.approvedRevisionId !== revision.id) throw Error("approved_current_revision_required");
}
async function releaseRun(context: AuthWorkspaceContext, runId: string) {
  return getPrisma().knowledgeReleaseRun.findFirstOrThrow({ where: { id: runId, workspaceId: context.workspaceId } });
}
function selectionSnapshot(value: unknown) {
  if (!Array.isArray(value) || !value.length) throw Error("knowledge_release_selection_snapshot_invalid");
  return value as Array<{ revisionId: string; metadata: unknown }>;
}
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw Error(`configure_${name.toLocaleLowerCase()}_first`);
  return value;
}

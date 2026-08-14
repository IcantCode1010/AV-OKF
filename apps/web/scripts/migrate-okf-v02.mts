import { createHash } from "node:crypto";
import { access, cp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { Prisma } from "@prisma/client";

import { buildOkfSourceReference } from "../src/lib/okf-export.ts";
import {
  getFrontmatterRelations,
  parseOkfMarkdown,
  serializeOkfMarkdown,
  type OkfV02Frontmatter,
} from "../src/lib/okf-frontmatter.ts";
import {
  BASE_FIELDS,
  normalizeKnowledgeProfile,
  type KnowledgeProfileSchema,
} from "../src/lib/knowledge-profile.ts";
import { buildBundleManifest } from "../src/lib/knowledge-bundles.ts";
import { getObjectStorage } from "../src/lib/production-storage.ts";
import { validateOkfV02BundleRoot } from "../src/lib/okf-v02-validation.ts";
import { normalizeOkfTopicFilePath } from "../src/lib/okf-topic-routing.ts";
import { getPrisma } from "../src/lib/prisma.ts";

const db = getPrisma();
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const workspaceFilter = readArg("--workspace");
const confirmed = readArg("--confirm") === "OKF-V0.2-CUTOVER";
const databaseBackup = readArg("--database-backup");
const vaultRoot = path.resolve(
  process.env.AV_OKF_KNOWLEDGE_ROOT ?? path.join(process.cwd(), "../../knowledge"),
);
const runId = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const cutoverWorkRoot = path.join(vaultRoot, ".okf-v02-cutover", runId);
const stagingRoot = path.join(cutoverWorkRoot, "staging");
const rollbackRoot = path.join(cutoverWorkRoot, "rollback");
const backupRoot = path.resolve(
  process.env.AV_OKF_CUTOVER_BACKUP_ROOT ??
    path.join(path.dirname(vaultRoot), `${path.basename(vaultRoot)}-v01-backup-${runId}`),
);
const journalPath = path.join(backupRoot, "okf-v02-migration-journal.json");
const reportRoot = path.join(process.cwd(), "../../docs/debug");

if (apply && (!confirmed || !databaseBackup)) {
  throw new Error("apply_requires_--confirm_OKF-V0.2-CUTOVER_and_--database-backup");
}
if (apply) await access(path.resolve(databaseBackup!));

type BundlePlan = {
  bundleId: string;
  bundleName: string;
  documentHashes: Record<string, string>;
  errors: string[];
  files: string[];
  profile: KnowledgeProfileSchema;
  sourceReferences: string[];
  stageRoot: string;
  warnings: string[];
  workspaceId: string;
};

type MigrationBundle = Prisma.KnowledgeBundleGetPayload<{
  include: {
    activeProfileVersion: true;
    documents: { include: { objects: true; topicRecords: true } };
  };
}>;

try {
  const bundles = await db.knowledgeBundle.findMany({
    include: {
      activeProfileVersion: true,
      documents: {
        include: {
          objects: { where: { kind: "original_pdf" } },
          topicRecords: true,
        },
      },
    },
    orderBy: [{ workspaceId: "asc" }, { id: "asc" }],
    where: {
      status: "active",
      okfVersion: { not: "0.2" },
      ...(workspaceFilter ? { workspaceId: workspaceFilter } : {}),
    },
  });
  if (bundles.length === 0) {
    console.log(JSON.stringify({ message: "all_active_bundles_already_v0_2", valid: true }, null, 2));
    process.exit(0);
  }

  const plans: BundlePlan[] = [];
  for (const bundle of bundles) {
    plans.push(await stageBundle(bundle));
  }
  const report = {
    apply,
    backupRoot: apply ? backupRoot : null,
    bundles: plans.map((plan) => ({
      bundleId: plan.bundleId,
      bundleName: plan.bundleName,
      documentHashes: plan.documentHashes,
      errors: plan.errors,
      files: plan.files,
      sourceReferences: plan.sourceReferences,
      warnings: plan.warnings,
      workspaceId: plan.workspaceId,
    })),
    databaseBackup: apply ? path.resolve(databaseBackup!) : null,
    generatedAt: new Date().toISOString(),
    okfVersion: "0.2",
    valid: plans.every((plan) => plan.errors.length === 0),
    vaultRoot,
  };
  await mkdir(reportRoot, { recursive: true });
  const reportBase = `okf-v02-cutover-${runId}`;
  await writeFile(path.join(reportRoot, `${reportBase}.json`), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(path.join(reportRoot, `${reportBase}.md`), renderReport(report));
  console.log(JSON.stringify(report, null, 2));
  if (!report.valid) throw new Error("okf_v02_preflight_failed");
  if (!apply) {
    await rm(cutoverWorkRoot, { force: true, recursive: true });
    process.exit(0);
  }

  await cp(vaultRoot, backupRoot, {
    recursive: true,
    errorOnExist: true,
    filter: (source) => !source.startsWith(path.join(vaultRoot, ".okf-v02-cutover")),
  });
  await writeFile(journalPath, `${JSON.stringify({
    bundles: plans.map((plan) => plan.bundleId),
    databaseBackup: path.resolve(databaseBackup!),
    runId,
    status: "activating",
    updatedAt: new Date().toISOString(),
    vaultBackup: backupRoot,
  }, null, 2)}\n`);
  const activated: Array<{ hadLiveDirectory: boolean; liveRoot: string; rollbackRoot: string }> = [];
  try {
    for (const plan of plans) {
      const liveRoot = bundleRoot(plan.workspaceId, plan.bundleId);
      const bundleRollbackRoot = path.join(
        rollbackRoot,
        plan.workspaceId,
        plan.bundleId,
      );
      await mkdir(path.dirname(bundleRollbackRoot), { recursive: true });
      const hadLiveDirectory = await pathExists(liveRoot);
      if (hadLiveDirectory) await rename(liveRoot, bundleRollbackRoot);
      activated.push({ hadLiveDirectory, liveRoot, rollbackRoot: bundleRollbackRoot });
      await mkdir(path.dirname(liveRoot), { recursive: true });
      await rename(plan.stageRoot, liveRoot);
      await writeFile(journalPath, `${JSON.stringify({
        activated: activated.map((entry) => entry.liveRoot),
        bundles: plans.map((candidate) => candidate.bundleId),
        runId,
        status: "activating",
        updatedAt: new Date().toISOString(),
      }, null, 2)}\n`);
    }

    await db.$transaction(async (tx) => {
      for (const plan of plans) {
        const latest = await tx.knowledgeBundleProfileVersion.aggregate({
          _max: { version: true },
          where: { bundleId: plan.bundleId },
        });
        const profileVersion = await tx.knowledgeBundleProfileVersion.create({
          data: {
            activatedAt: new Date(),
            bundleId: plan.bundleId,
            createdBy: "process:av-okf-v0.2-migration",
            schema: plan.profile as unknown as Prisma.InputJsonValue,
            status: "active",
            templateId: plan.profile.id,
            version: (latest._max.version ?? 0) + 1,
          },
        });
        await tx.knowledgeBundleProfileVersion.updateMany({
          data: { status: "superseded" },
          where: { bundleId: plan.bundleId, id: { not: profileVersion.id }, status: "active" },
        });
        await tx.knowledgeBundle.update({
          data: { activeProfileVersionId: profileVersion.id, okfVersion: "0.2" },
          where: { id: plan.bundleId },
        });
        for (const [documentId, digest] of Object.entries(plan.documentHashes)) {
          await tx.document.update({ data: { contentSha256: digest }, where: { id: documentId } });
        }
        await tx.okfConceptEmbedding.deleteMany({ where: { knowledgeBundleId: plan.bundleId } });
        await tx.okfConceptEmbeddingJob.deleteMany({ where: { knowledgeBundleId: plan.bundleId } });
      }
    });
  } catch (error) {
    for (const entry of activated.reverse()) {
      await rm(entry.liveRoot, { force: true, recursive: true });
      if (entry.hadLiveDirectory) await rename(entry.rollbackRoot, entry.liveRoot);
    }
    await writeFile(journalPath, `${JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
      runId,
      status: "rolled_back",
      updatedAt: new Date().toISOString(),
    }, null, 2)}\n`);
    throw error;
  }

  for (const entry of activated) {
    if (entry.hadLiveDirectory) await rm(entry.rollbackRoot, { force: true, recursive: true });
  }
  await rm(cutoverWorkRoot, { force: true, recursive: true });
  await writeFile(journalPath, `${JSON.stringify({
    bundles: plans.map((plan) => plan.bundleId),
    completedAt: new Date().toISOString(),
    runId,
    status: "completed",
  }, null, 2)}\n`);
  console.log(`OKF v0.2 cutover completed. Backup: ${backupRoot}`);
} finally {
  await db.$disconnect();
}

async function stageBundle(bundle: MigrationBundle) {
  const liveRoot = bundleRoot(bundle.workspaceId, bundle.id);
  const stageRoot = path.join(stagingRoot, "workspaces", bundle.workspaceId, "bundles", bundle.id);
  await rm(stageRoot, { force: true, recursive: true });
  await mkdir(stageRoot, { recursive: true });
  const errors: string[] = [];
  const warnings: string[] = [];
  const documentHashes: Record<string, string> = {};
  const sourceReferences = new Set<string>();
  const topics = new Map<string, (typeof bundle.documents)[number]["topicRecords"][number]>();
  const documents = new Map(bundle.documents.map((document) => [document.id, document]));
  for (const document of bundle.documents) {
    for (const topic of document.topicRecords) {
      if (!topic.exportedFilePath) continue;
      const normalized = normalizeOkfTopicFilePath(topic.exportedFilePath);
      if (!normalized) {
        errors.push(`unsafe_exported_file_path:${topic.id}`);
        continue;
      }
      topics.set(normalized, topic);
    }
  }

  const sourceByDocument = new Map<string, { digest: string; path: string }>();
  for (const document of bundle.documents) {
    const object = document.objects[0];
    if (!object) {
      if (document.topicRecords.some((topic) => topic.reviewStatus === "approved" && topic.exportedFilePath)) {
        errors.push(`document_source_missing:${document.id}`);
      }
      continue;
    }
    try {
      const digest = createHash("sha256").update(await getObjectStorage().getObject(object.objectKey)).digest("hex");
      documentHashes[document.id] = digest;
      const built = buildOkfSourceReference({
        document: {
          classificationCode: document.classificationCode,
          contentSha256: digest,
          documentType: document.documentType,
          effectivity: document.effectivity,
          mimeType: document.mimeType,
          originalFilename: document.originalFilename,
          revision: document.revision,
          sizeBytes: document.sizeBytes,
          sourceAuthority: document.sourceAuthority,
          subjectFamily: document.subjectFamily,
          title: document.title,
        },
        exportedAt: new Date(),
        knowledgeVersion: "0.2.0",
      });
      sourceByDocument.set(document.id, { digest, path: built.filename });
      await writeStageFile(stageRoot, built.filename, built.content);
      sourceReferences.add(built.filename);
    } catch (error) {
      errors.push(`document_source_unreadable:${document.id}:${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const files = await collectMarkdownFiles(liveRoot);
  const migratedFiles: string[] = [];
  let oldLog: string | null = null;
  let oldManifest: string | null = null;
  for (const filePath of files) {
    const markdown = await readFile(path.join(liveRoot, filePath), "utf8");
    if (filePath === "index.md") continue;
    if (filePath === "log.md") { oldLog = markdown; continue; }
    if (filePath === "source_manifest.md") { oldManifest = markdown; continue; }
    let parsed;
    try {
      parsed = parseOkfMarkdown(markdown);
    } catch (error) {
      errors.push(`frontmatter_invalid:${filePath}:${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    const topic = topics.get(filePath);
    const oldApproved = parsed.frontmatter.review_status === "approved";
    if (oldApproved && (!topic || topic.reviewStatus !== "approved")) {
      errors.push(`approved_topic_mapping_missing:${filePath}`);
      continue;
    }
    const document = topic ? documents.get(topic.documentId) : null;
    const source = topic ? sourceByDocument.get(topic.documentId) : null;
    if ((oldApproved || topic?.reviewStatus === "approved") && (!document || !source)) {
      errors.push(`approved_source_mapping_missing:${filePath}`);
      continue;
    }
    const frontmatter = migrateFrontmatter(parsed.frontmatter, topic, document, source);
    const body = appendRelationLinks(parsed.body, getFrontmatterRelations(frontmatter));
    await writeStageFile(stageRoot, filePath, serializeOkfMarkdown({ body, frontmatter }));
    migratedFiles.push(filePath);
  }

  if (oldLog || oldManifest) {
    const historyPath = "references/history/pre-v0.2-bundle-history.md";
    const historyBody = [
      "# Pre-v0.2 Bundle History",
      oldLog ? `\n## Previous log.md\n\n${oldLog.trim()}` : "",
      oldManifest ? `\n## Previous source_manifest.md\n\n${oldManifest.trim()}` : "",
    ].join("\n");
    await writeStageFile(stageRoot, historyPath, serializeOkfMarkdown({
      body: historyBody,
      frontmatter: {
        type: "reference",
        title: "Pre-v0.2 bundle history",
        resource: `urn:av-okf:bundle-history:${bundle.id}`,
        generated: { by: "process:av-okf-v0.2-migration", at: new Date().toISOString() },
        av_okf_role: "migration_history",
        status: "deprecated",
      },
    }));
    migratedFiles.push(historyPath);
  }
  migratedFiles.push(...sourceReferences);
  const uniqueFiles = [...new Set(migratedFiles)].sort();
  await writeStageFile(stageRoot, "index.md", buildIndex(bundle.name, uniqueFiles));
  await writeStageFile(stageRoot, "log.md", buildMigrationLog(bundle.name));
  const rawProfile = bundle.activeProfileVersion?.schema as unknown as KnowledgeProfileSchema | undefined;
  const profile = normalizeKnowledgeProfile(rawProfile ?? {
    agent: { boundedAdaptiveRetryEnabled: false }, automation: {
      autoApproveEnrichedTopics: false,
      autoApproveVerifiedRelations: false,
    },
    clarificationFields: [], fields: { type: { required: true, type: "string" } },
    id: "generic", name: "Generic", okfVersion: "0.2", relationDiscovery: { stopwords: [] }, relations: [], types: {},
  });
  profile.okfVersion = "0.2";
  const legacyProfileFields = new Set([
    "approved_at", "approved_by", "last_verified", "review_status", "source_file", "updated",
  ]);
  profile.fields = {
    ...BASE_FIELDS,
    ...Object.fromEntries(
      Object.entries(profile.fields).filter(([field]) => !legacyProfileFields.has(field)),
    ),
  };
  await writeStageFile(stageRoot, "okf-base.yaml", buildBundleManifest(profile));
  const validationIssues = await validateOkfV02BundleRoot(stageRoot);
  errors.push(...validationIssues.map((entry) => `${entry.filePath}:${entry.code}`));
  return {
    bundleId: bundle.id,
    bundleName: bundle.name,
    documentHashes,
    errors: [...new Set(errors)].sort(),
    files: uniqueFiles,
    profile,
    sourceReferences: [...sourceReferences].sort(),
    stageRoot,
    warnings,
    workspaceId: bundle.workspaceId,
  } satisfies BundlePlan;
}

function migrateFrontmatter(
  old: OkfV02Frontmatter,
  topic: { approvalMode: string | null; approvedAt: Date | null; approvedBy: string | null; reviewStatus: string; sourcePageNumbers: number[] } | undefined,
  document: { id: string; title: string } | null | undefined,
  source: { digest: string; path: string } | null | undefined,
): OkfV02Frontmatter {
  const frontmatter = { ...old };
  for (const key of ["review_status", "approved_by", "approved_at", "updated", "source_file"]) delete frontmatter[key];
  frontmatter.type = typeof old.type === "string" && old.type.trim() ? old.type : "concept";
  frontmatter.generated = old.generated ?? {
    by: "process:av-okf-v0.1-migration",
    at: new Date().toISOString(),
  };
  if (topic?.reviewStatus === "approved") {
    const mode = topic.approvalMode ?? "legacy";
    const actor = mode === "automated"
      ? "process:av-okf-auto-approval"
      : mode === "legacy" || !topic.approvedBy
        ? "process:av-okf-v0.1-migration"
        : `human:${topic.approvedBy.replace(/^human:/, "")}`;
    frontmatter.status = "stable";
    frontmatter.verified = [{ by: actor, at: (topic.approvedAt ?? new Date()).toISOString() }];
    frontmatter.av_okf_approval_mode = mode;
    frontmatter.source_pages = topic.sourcePageNumbers;
    if (document && source) {
      frontmatter.sources = [{
        id: `source-${source.digest.slice(0, 12)}`,
        resource: `/${source.path}`,
        title: document.title,
      }];
    }
  } else {
    frontmatter.status = old.status === "deprecated" ? "deprecated" : "draft";
    delete frontmatter.verified;
  }
  return frontmatter;
}

function appendRelationLinks(body: string, relations: ReturnType<typeof getFrontmatterRelations>) {
  const without = body.replace(/(?:\r?\n){0,2}## Relations\r?\n[\s\S]*?(?=(?:\r?\n){2}## |$)/, "").trimEnd();
  if (relations.length === 0) return without;
  return `${without}\n\n## Relations\n\n${relations.map((relation) =>
    `- [${relation.relation}](${relation.target}) - ${relation.reason}`,
  ).join("\n")}`;
}

function buildIndex(bundleName: string, files: string[]) {
  return serializeOkfMarkdown({
    body: `# ${bundleName}\n\n${files.map((file) => `- [${path.posix.basename(file, ".md")}](${file})`).join("\n")}`,
    frontmatter: {
      okf_version: "0.2",
    },
  });
}

function buildMigrationLog(bundleName: string) {
  const now = new Date();
  return `# Change Log\n\n## ${now.toISOString().slice(0, 10)}\n\n- ${now.toISOString()} - Migrated ${bundleName} to OKF v0.2.\n`;
}

async function collectMarkdownFiles(root: string) {
  const files: string[] = [];
  async function walk(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else if (entry.isFile() && entry.name.endsWith(".md")) files.push(normalizePath(path.relative(root, fullPath)));
    }
  }
  await walk(root);
  return files.sort();
}

async function writeStageFile(root: string, relativePath: string, content: string) {
  const normalized = normalizeOkfTopicFilePath(relativePath);
  if (!normalized) throw new Error("unsafe_staging_path");
  const target = path.join(root, ...normalized.split("/"));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

function bundleRoot(workspaceId: string, bundleId: string) {
  return path.join(vaultRoot, "workspaces", workspaceId, "bundles", bundleId);
}

async function pathExists(target: string) {
  try {
    await access(target);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function normalizePath(value: string) {
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

function readArg(name: string) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function renderReport(report: { apply: boolean; bundles: Array<{ bundleId: string; bundleName: string; errors: string[]; files: string[]; sourceReferences: string[] }>; generatedAt: string; valid: boolean }) {
  return `# OKF v0.2 Cutover ${report.apply ? "Apply" : "Dry Run"}\n\n- Generated: ${report.generatedAt}\n- Valid: ${report.valid}\n\n${report.bundles.map((bundle) =>
    `## ${bundle.bundleName}\n\n- Bundle: \`${bundle.bundleId}\`\n- Files: ${bundle.files.length}\n- Source references: ${bundle.sourceReferences.length}\n- Errors: ${bundle.errors.length}\n${bundle.errors.map((error) => `  - \`${error}\``).join("\n")}`,
  ).join("\n\n")}\n`;
}

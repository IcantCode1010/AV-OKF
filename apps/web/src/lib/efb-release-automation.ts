import {knowledgeFeature} from "./knowledge/contracts.ts";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import {
  EFB_POC_AUTHORITY_LABEL,
  exportEfbRelease,
  type EfbReleaseSourceEntry,
} from "./efb-release-export.ts";
import type { EfbReleaseQueue } from "./efb-release-queue.ts";
import { getWorkspaceLlmApiKeyForEnrichment } from "./llm-provider-settings.ts";
import { getLlmProvider } from "./llm-providers.ts";
import { getFrontmatterStringArray, serializeOkfMarkdown } from "./okf-frontmatter.ts";
import { getPrisma } from "./prisma.ts";
import {
  classifyAndPersistProjectEfbArticle,
  getProjectEfbArticleClassification,
  normalizeProjectEfbAtaChapter,
} from "./project-efb-article-classification.ts";

const execFileAsync = promisify(execFile);
const POC_LICENSE_IDENTIFIER = "POC-NOT-REVIEWED";
const POC_EXPORTER_VERSION = "project-efb-article-classification-v1";

type PocTopic = Awaited<ReturnType<typeof loadPocTopics>>[number];

export function getAutomaticEfbExportMode(): "disabled" | "poc" | "production" {
  const value = process.env.AV_OKF_EFB_EXPORT_MODE ?? "disabled";
  return value === "poc" || value === "production" ? value : "disabled";
}

export async function createAutomaticPocEfbReleaseJob(input: {
  authoringRunId: string;
  queue: EfbReleaseQueue;
}) {
  if (knowledgeFeature("shared") || getAutomaticEfbExportMode() !== "poc") return null;
  const db = getPrisma();
  const run = await db.knowledgeAuthoringRun.findUnique({
    include: { document: true, knowledgeBundle: true },
    where: { id: input.authoringRunId },
  });
  if (!run || run.status !== "ready_for_review" || run.document.sourceType !== "aviation") {
    return null;
  }
  const topics = await loadPocTopics(run.knowledgeBundleId, run.workspaceId);
  if (topics.length === 0) return null;
  const corpusHash = buildPocCorpusHash(topics);
  const existing = await db.efbReleaseJob.findUnique({
    where: {
      knowledgeBundleId_corpusHash_mode: {
        corpusHash,
        knowledgeBundleId: run.knowledgeBundleId,
        mode: "poc",
      },
    },
  });
  if (existing) {
    if (["queued", "running", "failed"].includes(existing.status)) {
      await input.queue.enqueue({ jobId: existing.id, workspaceId: existing.workspaceId });
    }
    return existing;
  }

  const packageId = `${slug(run.knowledgeBundle.slug || run.knowledgeBundle.name)}-poc`;
  const version = await nextPocPackageVersion(packageId);
  const created = await db.efbReleaseJob.create({
    data: {
      articleCount: topics.length,
      authoringRunId: run.id,
      corpusHash,
      documentId: run.documentId,
      knowledgeBundleId: run.knowledgeBundleId,
      mode: "poc",
      packageId,
      version,
      workspaceId: run.workspaceId,
    },
  }).catch(async (error) => {
    const raced = await db.efbReleaseJob.findUnique({
      where: {
        knowledgeBundleId_corpusHash_mode: {
          corpusHash,
          knowledgeBundleId: run.knowledgeBundleId,
          mode: "poc",
        },
      },
    });
    if (raced) return raced;
    throw error;
  });
  await input.queue.enqueue({ jobId: created.id, workspaceId: created.workspaceId });
  return created;
}

export async function runPocEfbReleaseJob(jobId: string) {
  const db = getPrisma();
  const claimed = await db.efbReleaseJob.updateMany({
    data: {
      attempts: { increment: 1 },
      errorCode: null,
      errorMessage: null,
      startedAt: new Date(),
      status: "running",
    },
    where: { id: jobId, mode: "poc", status: { in: ["queued", "running", "failed"] } },
  });
  let job = await db.efbReleaseJob.findUnique({ where: { id: jobId } });
  if (!job) throw new Error("efb_release_job_not_found");
  if (job.status === "completed") return job;
  if (claimed.count === 0) throw new Error("efb_release_job_not_claimable");

  try {
    let topics = await loadPocTopics(job.knowledgeBundleId, job.workspaceId);
    if (topics.length === 0) throw new Error("efb_poc_requires_completed_articles");
    if (topics.some((topic) => !getProjectEfbArticleClassification(topic.okfMetadata))) {
      const key = await getWorkspaceLlmApiKeyForEnrichment(job.workspaceId);
      if (!key) throw new Error("efb_article_classification_requires_api_key");
      const provider = getLlmProvider(key.provider);
      for (const topic of topics) {
        if (getProjectEfbArticleClassification(topic.okfMetadata)) continue;
        await classifyAndPersistProjectEfbArticle({
          apiKey: key.apiKey,
          model: provider.model,
          provider: key.provider,
          topicId: topic.id,
          workspaceId: job.workspaceId,
        });
      }
      topics = await loadPocTopics(job.knowledgeBundleId, job.workspaceId);
    }
    const corpusHash = buildPocCorpusHash(topics);
    if (corpusHash !== job.corpusHash) {
      job = await db.efbReleaseJob.update({
        data: { corpusHash },
        where: { id: job.id },
      });
    }
    const outputRoot = path.resolve(
      process.env.AV_OKF_EFB_RELEASE_ROOT ?? "/data/efb-releases",
    );
    if (await fileExists(path.join(outputRoot, `${job.packageId}@${job.version}`))) {
      job = await db.efbReleaseJob.update({
        data: { version: await nextPocPackageVersion(job.packageId) },
        where: { id: job.id },
      });
    }
    const sourceEntries = topics.map(buildPocSourceEntry);
    const timestamp = job.createdAt.toISOString();
    const result = await exportEfbRelease({
      config: {
        curatedAt: timestamp,
        curator: "av-okf-poc-export",
        license: {
          attribution: "Prototype content",
          identifier: POC_LICENSE_IDENTIFIER,
        },
        mode: "poc",
        packageId: job.packageId,
        schemaVersion: "1.0",
        source: "av-okf",
        sourceCommit: job.corpusHash.slice(0, 40),
        validatedAt: timestamp,
        validationProfile: "poc-structural-only",
        validator: "av-okf-poc-export",
        version: job.version,
      },
      outputRoot,
      sourceEntries,
      validateStagedPackage: validateWithProjectEfb,
    });
    return db.efbReleaseJob.update({
      data: {
        articleCount: result.manifest.entries.length,
        completedAt: new Date(),
        manifestPath: result.manifestPath,
        releaseDirectory: result.releaseDirectory,
        status: "completed",
      },
      where: { id: job.id },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.efbReleaseJob.update({
      data: { errorCode: errorCode(message), errorMessage: message, status: "failed" },
      where: { id: job.id },
    });
    throw error;
  }
}

export async function reconcilePocEfbReleaseJobs(queue: EfbReleaseQueue) {
  if (getAutomaticEfbExportMode() !== "poc") return 0;
  const db = getPrisma();
  const jobs = await db.efbReleaseJob.findMany({
    select: { id: true, workspaceId: true },
    where: { mode: "poc", status: { in: ["queued", "running"] } },
  });
  if (jobs.length > 0) {
    await db.efbReleaseJob.updateMany({
      data: { status: "queued" },
      where: { id: { in: jobs.map((job) => job.id) }, status: "running" },
    });
  }
  for (const job of jobs) await queue.enqueue({ jobId: job.id, workspaceId: job.workspaceId });
  const readyRuns = await db.knowledgeAuthoringRun.findMany({
    orderBy: { updatedAt: "desc" },
    select: { id: true, knowledgeBundleId: true },
    where: {
      document: { deletedAt: null, sourceType: "aviation" },
      knowledgeBundle: { status: "active" },
      status: "ready_for_review",
    },
  });
  const seenBundles = new Set<string>();
  let createdOrReused = 0;
  for (const run of readyRuns) {
    if (seenBundles.has(run.knowledgeBundleId)) continue;
    seenBundles.add(run.knowledgeBundleId);
    const release = await createAutomaticPocEfbReleaseJob({ authoringRunId: run.id, queue });
    if (release) createdOrReused += 1;
  }
  return jobs.length + createdOrReused;
}

export function buildPocCorpusHash(topics: PocTopic[]): string {
  return sha256(JSON.stringify({
    exporterVersion: POC_EXPORTER_VERSION,
    topics: topics.map((topic) => ({
    aircraftFamilyIds: [...topic.document.aircraftFamilyIds].sort(),
    aircraftTypeIds: [...topic.document.aircraftTypeIds].sort(),
    applicabilityScope: topic.document.applicabilityScope,
    applicabilityStatus: topic.document.applicabilityStatus,
    audiences: [...topic.document.intendedAudiences].sort(),
    ata: topic.document.classificationCode,
    body: topic.enrichedBody,
    documentHash: topic.document.contentSha256,
    id: topic.id,
    projectEfb: getProjectEfbArticleClassification(topic.okfMetadata),
    pages: [...topic.sourcePageNumbers].sort((left, right) => left - right),
    summary: topic.enrichedSummary ?? topic.summary,
    title: topic.enrichedTitle ?? topic.title,
    updatedAt: topic.updatedAt.toISOString(),
    })),
  }));
}

export function buildPocSourceEntry(topic: PocTopic): EfbReleaseSourceEntry {
  const title = (topic.enrichedTitle ?? topic.title).trim();
  const summary = (topic.enrichedSummary ?? topic.summary).trim();
  const body = topic.enrichedBody?.trim();
  if (!title) throw new Error(`efb_entry_title_required:${topic.id}`);
  if (!summary) throw new Error(`efb_entry_summary_required:${topic.id}`);
  if (!body) throw new Error(`efb_entry_body_required:${topic.id}`);
  if (topic.sourcePageNumbers.length === 0) {
    throw new Error(`efb_entry_source_pages_invalid:${topic.id}`);
  }
  const projectEfb = getProjectEfbArticleClassification(topic.okfMetadata);
  if (!projectEfb) throw new Error(`efb_article_classification_required:${topic.id}`);
  if (projectEfb.status !== "accepted") {
    throw new Error(`efb_article_classification_requires_review:${topic.id}`);
  }
  if (topic.document.applicabilityStatus !== "accepted" && topic.document.applicabilityStatus !== "manual_override") {
    throw new Error(`efb_applicability_requires_review:${topic.id}`);
  }
  const resolvedApplicability = resolvePocAircraftApplicability({
    articleAircraftFamilyIds: projectEfb.aircraftFamilyIds,
    articleAircraftTypeIds: projectEfb.aircraftTypeIds,
    documentAircraftFamilyIds: topic.document.aircraftFamilyIds,
    documentAircraftTypeIds: topic.document.aircraftTypeIds,
    documentApplicabilityStatus: topic.document.applicabilityStatus,
  });
  const { aircraftFamilyIds, aircraftTypeIds, manualApplicability } = resolvedApplicability;
  if (aircraftFamilyIds.length === 0 && aircraftTypeIds.length === 0) {
    throw new Error(`efb_metadata_required:aircraft_applicability:${topic.id}`);
  }
  if (projectEfb.audiences.length === 0) {
    throw new Error(`efb_metadata_required:intended_audiences:${topic.id}`);
  }
  const ata = projectEfb.ataChapter;
  const sourceIdentifier = topic.document.classificationCode &&
      !normalizeProjectEfbAtaChapter(topic.document.classificationCode)
    ? topic.document.classificationCode
    : null;
  const sourceId = `source-${(topic.document.contentSha256 ?? sha256(topic.document.id)).slice(0, 12)}`;
  const entryId = buildStableEfbEntryId(topic.id);
  const topicTags = getFrontmatterStringArray(
    asRecord(topic.okfMetadata),
    "tags",
  );
  const tags = unique([...topic.document.tags, ...topicTags]);
  const exportedProjectEfb = manualApplicability
    ? {
        ...projectEfb,
        aircraftFamilyIds,
        aircraftTypeIds,
        classificationSource: "manual",
        documentOverride: true,
      }
    : projectEfb;
  return {
    markdown: serializeOkfMarkdown({
      body,
      frontmatter: {
        aircraft_family: topic.document.subjectFamily ?? undefined,
        aircraft_family_ids: aircraftFamilyIds,
        aircraft_type_ids: aircraftTypeIds,
        applicability_confidence: topic.document.applicabilityConfidence ?? undefined,
        applicability_evidence: topic.document.applicabilityEvidence,
        applicability_model: topic.document.applicabilityModel ?? undefined,
        applicability_scope: topic.document.applicabilityScope ?? undefined,
        applicability_status: topic.document.applicabilityStatus ?? undefined,
        ata: ata ?? undefined,
        description: summary,
        efb_entry_id: entryId,
        effectivity: topic.document.effectivity ?? undefined,
        intended_audiences: projectEfb.audiences,
        manual_type: topic.document.documentType ?? undefined,
        source_pages: [...topic.sourcePageNumbers].sort((left, right) => left - right),
        source_identifier: sourceIdentifier ?? undefined,
        sources: [{
          id: sourceId,
          resource: topic.document.contentSha256
            ? `urn:sha256:${topic.document.contentSha256}`
            : `document:${topic.document.id}`,
          title: sourceIdentifier
            ? `${topic.document.title} (${sourceIdentifier})`
            : topic.document.title,
        }],
        status: "stable",
        tags,
        title,
        type: topic.topicType,
        extensions: {
          projectEfb: structuredClone(exportedProjectEfb),
        },
      },
    }),
    relativePath: `topics/${entryId}.md`,
  };
}

export function resolvePocAircraftApplicability(input: {
  articleAircraftFamilyIds: string[];
  articleAircraftTypeIds: string[];
  documentAircraftFamilyIds: string[];
  documentAircraftTypeIds: string[];
  documentApplicabilityStatus: string | null;
}) {
  const manualApplicability = input.documentApplicabilityStatus === "manual_override";
  return {
    aircraftFamilyIds: [...(manualApplicability
      ? input.documentAircraftFamilyIds
      : input.articleAircraftFamilyIds)],
    aircraftTypeIds: [...(manualApplicability
      ? input.documentAircraftTypeIds
      : input.articleAircraftTypeIds)],
    manualApplicability,
  };
}

export function buildStableEfbEntryId(topicId: string): string {
  return `article-${sha256(topicId).slice(0, 20)}`;
}

export function selectNextPocPackageVersion(versions: string[]): string {
  const latestPatch = versions.reduce((latest, version) => {
    const match = /^0\.1\.(\d+)$/.exec(version);
    return match ? Math.max(latest, Number(match[1])) : latest;
  }, -1);
  return `0.1.${latestPatch + 1}`;
}

async function loadPocTopics(knowledgeBundleId: string, workspaceId: string) {
  return getPrisma().topicRecord.findMany({
    include: {
      document: {
        select: {
          aircraftFamilyIds: true,
          aircraftTypeIds: true,
          applicabilityConfidence: true,
          applicabilityEvidence: true,
          applicabilityModel: true,
          applicabilityScope: true,
          applicabilityStatus: true,
          classificationCode: true,
          contentSha256: true,
          deletedAt: true,
          documentType: true,
          effectivity: true,
          id: true,
          intendedAudiences: true,
          originalFilename: true,
          sourceType: true,
          subjectFamily: true,
          tags: true,
          title: true,
        },
      },
    },
    orderBy: [{ documentId: "asc" }, { pageStart: "asc" }, { id: "asc" }],
    where: {
      document: { deletedAt: null, sourceType: "aviation" },
      enrichedBody: { not: null },
      enrichmentStatus: "completed",
      knowledgeBundleId,
      reviewStatus: { not: "rejected" },
      workspaceId,
    },
  });
}

async function validateWithProjectEfb(manifestPath: string) {
  const root = process.env.PROJECT_EFB_ROOT;
  if (!root) throw new Error("efb_contract_root_required");
  const validator = path.join(root, "scripts", "validate-knowledge-package.mjs");
  await execFileAsync(process.execPath, [validator, manifestPath], { cwd: root });
}

async function nextPocPackageVersion(packageId: string): Promise<string> {
  const outputRoot = path.resolve(
    process.env.AV_OKF_EFB_RELEASE_ROOT ?? "/data/efb-releases",
  );
  const [jobs, directoryEntries] = await Promise.all([
    getPrisma().efbReleaseJob.findMany({
      select: { version: true },
      where: { mode: "poc", packageId },
    }),
    readdir(outputRoot, { withFileTypes: true }).catch(() => []),
  ]);
  const prefix = `${packageId}@`;
  const diskVersions = directoryEntries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => entry.name.slice(prefix.length));
  return selectNextPocPackageVersion([
    ...jobs.map(({ version }) => version),
    ...diskVersions,
  ]);
}

async function fileExists(location: string): Promise<boolean> {
  try {
    await stat(location);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function errorCode(message: string) {
  return message.split(":", 1)[0]?.slice(0, 120) || "efb_release_failed";
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "knowledge";
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export { EFB_POC_AUTHORITY_LABEL, POC_LICENSE_IDENTIFIER };

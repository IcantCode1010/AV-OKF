import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Queue } from "bullmq";

import { buildOkfRelationVerificationJobId } from "../src/lib/okf-relation-verification-queue.ts";
import {
  isWeakPublishedRelationRationale,
  parseRelationStabilizationOptions,
  RELATION_STABILIZATION_CONFIRMATION,
  resolvePublishedRelationSnapshot,
  topicContainsPublishedRelation,
} from "../src/lib/okf-relation-stabilization.ts";
import { getPrisma } from "../src/lib/prisma.ts";

const options = parseRelationStabilizationOptions(process.argv.slice(2));
const db = getPrisma();
const pending = await db.okfRelationCandidate.findMany({
  orderBy: [{ workspaceId: "asc" }, { knowledgeBundleId: "asc" }, { id: "asc" }],
  select: { discoveryRunId: true, id: true, knowledgeBundleId: true, verificationStatus: true, workspaceId: true },
  where: { status: "pending" },
});
const approved = await db.okfRelationCandidate.findMany({
  orderBy: [{ workspaceId: "asc" }, { knowledgeBundleId: "asc" }, { id: "asc" }],
  select: {
    id: true,
    knowledgeBundleId: true,
    reason: true,
    relation: true,
    sourceFile: true,
    targetFile: true,
    verificationDirection: true,
    verificationRationale: true,
    verificationRelation: true,
    workspaceId: true,
  },
  where: { publishedReviewStatus: null, status: "approved" },
});
const weakApproved = approved.filter((candidate) => isWeakPublishedRelationRationale(candidate.verificationRationale));
type ApprovedCandidate = (typeof approved)[number];
type PublishedSnapshot = ReturnType<typeof resolvePublishedRelationSnapshot>;
const resolvable: Array<{ candidate: ApprovedCandidate; snapshot: PublishedSnapshot }> = [];
const unresolved: Array<{ candidateId: string; knowledgeBundleId: string; workspaceId: string }> = [];
for (const candidate of weakApproved) {
  const snapshot = resolvePublishedRelationSnapshot(candidate);
  const sourceTopic = await db.topicRecord.findFirst({
    select: { relations: true },
    where: {
      exportedFilePath: snapshot.publishedSourceFile,
      knowledgeBundleId: candidate.knowledgeBundleId,
      reviewStatus: "approved",
      workspaceId: candidate.workspaceId,
    },
  });
  if (!sourceTopic || !topicContainsPublishedRelation(sourceTopic.relations, snapshot)) {
    unresolved.push({ candidateId: candidate.id, knowledgeBundleId: candidate.knowledgeBundleId, workspaceId: candidate.workspaceId });
    continue;
  }
  resolvable.push({ candidate, snapshot });
}

const report = {
  apply: options.apply,
  confirmationRequired: RELATION_STABILIZATION_CONFIRMATION,
  pendingByStatus: Object.fromEntries([...new Set(pending.map((candidate) => candidate.verificationStatus))]
    .sort()
    .map((status) => [status, pending.filter((candidate) => candidate.verificationStatus === status).length])),
  pendingCandidates: pending.length,
  publishedRelationsFlaggable: resolvable.length,
  publishedRelationsUnresolved: unresolved,
};

if (!options.apply) {
  await emitReport({ ...report, status: "dry_run" });
  await db.$disconnect();
  process.exit(0);
}

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) throw new Error("missing_env_REDIS_URL");
const queue = new Queue("okf-relation-verification", { connection: { url: redisUrl } });
await queue.pause();
try {
  const activeDeadline = Date.now() + 30_000;
  while (await queue.getJobCountByTypes("active")) {
    if (Date.now() >= activeDeadline) throw new Error("relation_verification_queue_did_not_quiesce");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  for (const candidate of pending) {
    await queue.remove(`okf-relation-verification-${candidate.id}`).catch(() => undefined);
  }
  await db.$transaction(async (tx) => {
    await tx.okfRelationCandidate.deleteMany({ where: { status: "pending" } });
    for (const { candidate, snapshot } of resolvable) {
      await tx.okfRelationCandidate.update({
        data: {
          publishedRelation: snapshot.publishedRelation,
          publishedReason: snapshot.publishedReason,
          publishedReviewFlaggedAt: new Date(),
          publishedReviewStatus: "queued",
          publishedSourceFile: snapshot.publishedSourceFile,
          publishedTargetFile: snapshot.publishedTargetFile,
          requestedDirection: snapshot.direction,
          verificationConfidence: null,
          verificationError: null,
          verificationEvidenceQuote: null,
          verificationRationale: null,
          verificationRelation: null,
          verificationStatus: "queued",
          verifiedAt: null,
        },
        where: { id: candidate.id },
      });
    }
    const runIds = [...new Set(pending.flatMap((candidate) => candidate.discoveryRunId ? [candidate.discoveryRunId] : []))];
    for (const runId of runIds) {
      await tx.okfRelationDiscoveryRun.update({
        data: {
          completedAt: new Date(),
          confirmedCount: 0,
          failedCount: 0,
          filteredCount: 0,
          queuedCount: 0,
          runningCount: 0,
          status: "completed",
          totalCandidates: 0,
        },
        where: { id: runId },
      });
    }
  });
  for (const { candidate } of resolvable) {
    await queue.add("verify-relation", {
      candidateId: candidate.id,
      knowledgeBundleId: candidate.knowledgeBundleId,
      workspaceId: candidate.workspaceId,
    }, {
      attempts: 3,
      backoff: { delay: 5_000, type: "exponential" },
      jobId: buildOkfRelationVerificationJobId(candidate.id),
      removeOnComplete: 500,
      removeOnFail: 1_000,
    });
  }
  await emitReport({ ...report, status: "applied" });
} finally {
  await queue.resume();
  await queue.close();
  await db.$disconnect();
}

async function emitReport(value: typeof report & { status: string }) {
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const reportDirectory = path.resolve(scriptDirectory, "../../../backups/relation-stabilization");
  await mkdir(reportDirectory, { recursive: true });
  const basename = `relation-stabilization-${value.status === "dry_run" ? "dry-run" : "apply"}`;
  const jsonPath = path.join(reportDirectory, `${basename}.json`);
  const markdownPath = path.join(reportDirectory, `${basename}.md`);
  await writeFile(jsonPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, [
    "# Relation Stabilization Report",
    "",
    `- Status: ${value.status}`,
    `- Pending candidates: ${value.pendingCandidates}`,
    `- Published relations eligible for revalidation: ${value.publishedRelationsFlaggable}`,
    `- Published relations requiring manual resolution: ${value.publishedRelationsUnresolved.length}`,
    "",
    "## Pending Candidates By Verification Status",
    "",
    ...Object.entries(value.pendingByStatus).map(([status, count]) => `- ${status}: ${count}`),
    "",
    "## Unresolved Published Relations",
    "",
    ...(value.publishedRelationsUnresolved.length
      ? value.publishedRelationsUnresolved.map((item) => `- ${item.workspaceId} / ${item.knowledgeBundleId} / ${item.candidateId}`)
      : ["None."]),
    "",
  ].join("\n"), "utf8");
  process.stdout.write(`${JSON.stringify({ ...value, reports: { jsonPath, markdownPath } }, null, 2)}\n`);
}

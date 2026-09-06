import { createAutomaticPocEfbReleaseJob } from "../src/lib/efb-release-automation.ts";
import { createEfbReleaseQueue } from "../src/lib/efb-release-queue.ts";
import { getWorkspaceLlmApiKeyForEnrichment } from "../src/lib/llm-provider-settings.ts";
import { getLlmProvider } from "../src/lib/llm-providers.ts";
import { getPrisma } from "../src/lib/prisma.ts";
import { classifyAndPersistProjectEfbArticle } from "../src/lib/project-efb-article-classification.ts";

const documentId = process.argv[2]?.trim();
if (!documentId) throw new Error("usage: reprocess-project-efb-classifications.mts <document-id> [--queue-release]");
const queueRelease = process.argv.includes("--queue-release");
const db = getPrisma();
const document = await db.document.findFirstOrThrow({
  select: { id: true, sourceType: true, workspaceId: true },
  where: { deletedAt: null, id: documentId },
});
if (document.sourceType !== "aviation") throw new Error("project_efb_classification_requires_aviation_document");
const key = await getWorkspaceLlmApiKeyForEnrichment(document.workspaceId);
if (!key) throw new Error("project_efb_classification_requires_api_key");
const provider = getLlmProvider(key.provider);
const topics = await db.topicRecord.findMany({
  orderBy: [{ pageStart: "asc" }, { id: "asc" }],
  select: { id: true, title: true },
  where: {
    documentId: document.id,
    enrichedBody: { not: null },
    enrichmentStatus: "completed",
    reviewStatus: { not: "rejected" },
    workspaceId: document.workspaceId,
  },
});
if (topics.length === 0) throw new Error("project_efb_classification_requires_enriched_topics");

let accepted = 0;
let needsReview = 0;
for (const [index, topic] of topics.entries()) {
  const classification = await classifyAndPersistProjectEfbArticle({
    apiKey: key.apiKey,
    model: provider.model,
    provider: key.provider,
    topicId: topic.id,
    workspaceId: document.workspaceId,
  });
  if (classification?.status === "accepted") accepted += 1;
  else needsReview += 1;
  console.log(`${index + 1}/${topics.length} ${topic.title}: ${classification?.status ?? "skipped"} ATA ${classification?.ataChapter ?? "unplaced"}`);
}

if (queueRelease && needsReview === 0) {
  const run = await db.knowledgeAuthoringRun.findFirstOrThrow({
    orderBy: { updatedAt: "desc" },
    select: { id: true },
    where: { documentId: document.id, status: "ready_for_review", workspaceId: document.workspaceId },
  });
  const queue = createEfbReleaseQueue();
  try {
    const release = await createAutomaticPocEfbReleaseJob({ authoringRunId: run.id, queue });
    console.log(`Queued immutable release ${release?.packageId}@${release?.version}.`);
  } finally {
    await queue.close();
  }
}
if (queueRelease && needsReview > 0) {
  throw new Error(`project_efb_release_blocked_by_classification:${needsReview}`);
}

console.log(`Project EFB classification complete: ${accepted} accepted, ${needsReview} need review.`);

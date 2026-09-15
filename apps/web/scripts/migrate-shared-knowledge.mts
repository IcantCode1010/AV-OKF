import assert from "node:assert/strict";
import { getPrisma } from "../src/lib/prisma.ts";
import { backfillEditorial } from "../src/lib/knowledge/editorial.ts";
import { fingerprint } from "../src/lib/topic-builder-core.ts";
const workspaceId = process.argv[2];
if (!workspaceId)
  throw Error("Usage: migrate-shared-knowledge.mts <workspace-id>");
const db = getPrisma();
async function legacySnapshot() {
  return {
    documents: await db.document.findMany({
      where: { workspaceId },
      orderBy: { id: "asc" },
      select: { id: true, contentSha256: true },
    }),
    topics: await db.topicRecord.findMany({
      where: { workspaceId },
      orderBy: { id: "asc" },
      select: {
        id: true,
        reviewStatus: true,
        approvedBy: true,
        approvedAt: true,
        exportedFilePath: true,
      },
    }),
    conversations: await db.chatSession.findMany({
      where: { workspaceId },
      orderBy: { id: "asc" },
      select: { id: true, scopeVersion: true },
    }),
  };
}
try {
  await db.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
  const before = await legacySnapshot();
  await backfillEditorial(workspaceId);
  const first = await db.knowledgeArticleRevision.findMany({
    where: { workspaceId },
    orderBy: { id: "asc" },
    select: { id: true, body: true, evidence: true, approval: true },
  });
  await backfillEditorial(workspaceId);
  const second = await db.knowledgeArticleRevision.findMany({
    where: { workspaceId },
    orderBy: { id: "asc" },
    select: { id: true, body: true, evidence: true, approval: true },
  });
  assert.equal(
    fingerprint(first),
    fingerprint(second),
    "Backfill is not idempotent",
  );
  assert.equal(
    fingerprint(before),
    fingerprint(await legacySnapshot()),
    "Legacy identities or approvals changed",
  );
  console.log(
    JSON.stringify({
      result: "passed",
      documents: before.documents.length,
      topics: before.topics.length,
      conversations: before.conversations.length,
      sharedRevisions: first.length,
      idempotent: true,
      legacyPreserved: true,
    }),
  );
} finally {
  await db.$disconnect();
}

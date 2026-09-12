import { getPrisma } from "../src/lib/prisma.ts";
import { runKnowledgeResearch } from "../src/lib/knowledge/research.ts";
import { traverseOkfRelations } from "../src/lib/okf-graph-retriever.ts";
import { resolveKnowledgeBundleRoot } from "../src/lib/knowledge-bundles.ts";
import { createPostgresOkfConceptLifecycleLookup } from "../src/lib/okf-lifecycle.ts";

const db = getPrisma();
try {
  const topic = await db.topicRecord.findFirstOrThrow({ where: { title: "Starting with a Ground Air Source", reviewStatus: "approved", exportedFilePath: { not: null } } });
  const member = await db.workspaceMember.findFirstOrThrow({ where: { workspaceId: topic.workspaceId, role: "admin" } });
  if (process.argv.includes("--inspect")) {
    const topics = await db.topicRecord.findMany({ where: { workspaceId: topic.workspaceId, knowledgeBundleId: topic.knowledgeBundleId, reviewStatus: "approved", exportedFilePath: { not: null } }, select: { exportedFilePath: true } });
    const graph = await traverseOkfRelations({ workspaceId: topic.workspaceId, knowledgeBundleId: topic.knowledgeBundleId,
      knowledgeRoot: resolveKnowledgeBundleRoot({ workspaceId: topic.workspaceId, bundleId: topic.knowledgeBundleId }),
      lifecycleLookup: createPostgresOkfConceptLifecycleLookup(), seedFiles: [topic.exportedFilePath!], allowedFiles: topics.map((item) => item.exportedFilePath!), direction: "both", maxHops: 1, maxMilliseconds: 4000 });
    console.log(JSON.stringify({ inspected: graph.inspectedFiles, paths: graph.paths, warnings: graph.warnings }));
  } else {
  const started = Date.now();
  const result = await runKnowledgeResearch({ context: { workspaceId: member.workspaceId, userId: member.userId, role: "admin" },
    collectionIds: [topic.knowledgeBundleId], consumer: "chat",
    query: `Research the published graph connections for the topic "${topic.title}" (topic ID ${topic.id}). Follow its published links, then read the original source pages for both endpoints. Identify the relevant passages and report any missing support. Do not provide operating instructions.` });
  console.log(JSON.stringify({ runId: result.runId, seconds: (Date.now() - started) / 1000,
    coverage: result.result.coverage, evidenceCount: result.result.evidence.length, graphConnections: result.result.graphConnections?.length ?? 0,
    toolCalls: result.result.toolCalls, modelSteps: result.result.modelSteps, gaps: result.result.gaps }));
  if (!result.result.evidence.length || !result.result.graphConnections?.length) process.exitCode = 2;
  }
} finally { await db.$disconnect(); }

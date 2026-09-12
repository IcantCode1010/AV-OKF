import { getPrisma } from "../src/lib/prisma.ts";
import { createProductionChatService } from "../src/lib/production-chat-service.ts";

const db = getPrisma();
try {
  const topic = await db.topicRecord.findFirstOrThrow({ where: { title: "SOURCE OFF (single)", reviewStatus: "approved", exportedFilePath: { not: null } } });
  const member = await db.workspaceMember.findFirstOrThrow({ where: { workspaceId: topic.workspaceId, role: "admin" } });
  const service = createProductionChatService(undefined, { getContext: async () => ({ workspaceId: member.workspaceId, userId: member.userId, role: "admin" }) });
  const session = await service.createSession(topic.knowledgeBundleId, "Graph verification: published source connections");
  console.log(JSON.stringify({ sessionId: session.id }));
  const started = Date.now();
  const missing = process.argv.includes("--missing");
  const incoming = process.argv.includes("--incoming");
  const result = await service.sendMessage(session.id,
    incoming ? `Which published topics refer to "Loss of Both Engine-Driven Generators"? Begin with that target and follow incoming published links. Read and cite the original source pages for the referring topic and target. Describe only the document relationship, not operating instructions, and preserve the source-to-target direction.` : missing ? `Find the published knowledge-graph relationship between "SOURCE OFF (single)" and "Quantum Flux Stabilizer QFS-999" in this collection. If either endpoint or relationship is absent, say so. Do not substitute a different component or invent a link.` : `Explain the published knowledge-graph relationship between "SOURCE OFF (single)" (topic ID ${topic.id}) and "Loss of Both Engine-Driven Generators". Follow published links in both directions and read original pages for both endpoints. Cite a passage for each endpoint and describe the document cross-reference only, without giving operating instructions.`);
  const message = result.assistantMessage;
  const stored = await db.chatMessage.findUniqueOrThrow({ where: { id: message.id } });
  const trace = stored.trace as typeof message.trace;
  console.log(JSON.stringify({ messageId: message.id, seconds: (Date.now() - started) / 1000, outcome: message.trace?.answerOutcome,
    citations: message.citations.map((citation) => ({ index: citation.index, page: citation.pageStart, researchEvidenceId: citation.researchEvidenceId })),
    connections: trace?.answerConnections, content: message.content }));
  if (missing ? Boolean(trace?.answerConnections?.length) || !/absent|not found|no evidence|could not find|cannot find|not present/i.test(message.content)
    : !message.citations.length || !trace?.answerConnections?.length) process.exitCode = 2;
  if (incoming && !trace?.answerConnections?.some((edge) => edge.sourceTitle === "SOURCE OFF (single)" && edge.targetTitle === "Loss of Both Engine-Driven Generators")) process.exitCode = 2;
} finally { await db.$disconnect(); }

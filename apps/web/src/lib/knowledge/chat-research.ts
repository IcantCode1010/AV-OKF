import type { AuthWorkspaceContext } from "../auth-workspace.ts";
import type { ChatRetrievalResult } from "../chat-retrieval.ts";
import { runKnowledgeResearch } from "./research.ts";
import { projectResearchChatEvidence } from "./chat-research-projection.ts";
export async function researchChatEvidence(
  context: AuthWorkspaceContext,
  sessionId: string,
  query: string,
  collectionIds: string[],
  base: ChatRetrievalResult,
) {
  const research = await runKnowledgeResearch({
    context,
    ownerId: sessionId,
    query,
    consumer: "chat",
    collectionIds,
  });
  return { research, result: projectResearchChatEvidence(base, research.result) };
}

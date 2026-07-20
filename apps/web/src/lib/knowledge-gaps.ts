import type { AuthWorkspaceContext } from "./auth-workspace.ts";
import { getPrisma } from "./prisma.ts";

export type KnowledgeGapDraft = {
  question: string;
  reason: "no_matching_evidence" | "related_evidence_not_answering";
  retrievalQuery: string;
  route: string;
  searchedSources: string[];
};

export type KnowledgeGap = KnowledgeGapDraft & {
  createdAt: string;
  id: string;
  status: string;
};

export async function listKnowledgeGaps(input: {
  context: AuthWorkspaceContext;
  knowledgeBundleId: string;
}): Promise<KnowledgeGap[]> {
  const records = await getPrisma().knowledgeGap.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    where: {
      knowledgeBundleId: input.knowledgeBundleId,
      status: "open",
      workspaceId: input.context.workspaceId,
    },
  });

  return records.map((record) => ({
    createdAt: record.createdAt.toISOString(),
    id: record.id,
    question: record.question,
    reason: record.reason as KnowledgeGap["reason"],
    retrievalQuery: record.retrievalQuery,
    route: record.route,
    searchedSources: record.searchedSources,
    status: record.status,
  }));
}

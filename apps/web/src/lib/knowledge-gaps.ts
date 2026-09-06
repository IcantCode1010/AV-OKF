import type { AuthWorkspaceContext } from "./auth-workspace.ts";
import type { ChatEvidenceStatus } from "./chat-router.ts";
import { getPrisma } from "./prisma.ts";
import type { RetrievalTriggerCandidate } from "./retrieval-trigger-proposals.ts";

export type KnowledgeGapDraft = {
  finalEvidenceStatus: ChatEvidenceStatus;
  question: string;
  reason: "no_matching_evidence" | "related_evidence_not_answering";
  retrievalQuery: string;
  route: string;
  searchedSources: string[];
  retrievalTriggerCandidates?: RetrievalTriggerCandidate[];
};

export type KnowledgeGap = Omit<KnowledgeGapDraft, "retrievalTriggerCandidates"> & {
  createdAt: string;
  id: string;
  status: string;
  retrievalTriggerProposals: Array<{
    approvedTerms: string[];
    id: string;
    matchReason: string;
    status: string;
    suggestedTerms: string[];
    targetFilePath: string;
    targetTitle: string;
  }>;
};

export async function listKnowledgeGaps(input: {
  context: AuthWorkspaceContext;
  knowledgeBundleId: string;
}): Promise<KnowledgeGap[]> {
  const records = await getPrisma().knowledgeGap.findMany({
    include: {
      retrievalTriggerProposals: {
        orderBy: { createdAt: "asc" },
        where: { knowledgeBundleId: input.knowledgeBundleId },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    where: {
      OR: [
        { primaryKnowledgeBundleId: input.knowledgeBundleId },
        {
          retrievalTriggerProposals: {
            some: { knowledgeBundleId: input.knowledgeBundleId },
          },
        },
      ],
      status: "open",
      workspaceId: input.context.workspaceId,
    },
  });

  return records.map((record) => ({
    createdAt: record.createdAt.toISOString(),
    finalEvidenceStatus: record.finalEvidenceStatus as ChatEvidenceStatus,
    id: record.id,
    question: record.question,
    reason: record.reason as KnowledgeGap["reason"],
    retrievalQuery: record.retrievalQuery,
    retrievalTriggerProposals: record.retrievalTriggerProposals.map((proposal) => ({
      approvedTerms: proposal.approvedTerms,
      id: proposal.id,
      matchReason: proposal.matchReason,
      status: proposal.status,
      suggestedTerms: proposal.suggestedTerms,
      targetFilePath: proposal.targetFilePath,
      targetTitle: proposal.targetTitle,
    })),
    route: record.route,
    searchedSources: record.searchedSources,
    status: record.status,
  }));
}

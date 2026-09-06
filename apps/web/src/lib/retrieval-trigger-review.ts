import type { AuthWorkspaceContext } from "./auth-workspace.ts";
import { getKnowledgeBundle, resolveKnowledgeBundleRoot } from "./knowledge-bundles.ts";
import { readOkfBundleFile } from "./okf-bundle.ts";
import { hashOkfSource } from "./okf-concept-embedding-content.ts";
import { normalizeOkfTopicFilePath } from "./okf-topic-routing.ts";
import { getPrisma } from "./prisma.ts";
import { normalizeRetrievalTriggerTerms } from "./retrieval-trigger-proposals.ts";

export async function reviewRetrievalTriggerProposal(input: {
  context: AuthWorkspaceContext;
  decision: "approve" | "reject";
  knowledgeBundleId: string;
  proposalId: string;
  terms?: string[];
}, dependencies: {
  getBundle?: typeof getKnowledgeBundle;
  prisma?: ReturnType<typeof getPrisma>;
  readBundleFile?: typeof readOkfBundleFile;
  resolveBundleRoot?: typeof resolveKnowledgeBundleRoot;
} = {}) {
  const prisma = dependencies.prisma ?? getPrisma();
  const getBundle = dependencies.getBundle ?? getKnowledgeBundle;
  const readBundleFile = dependencies.readBundleFile ?? readOkfBundleFile;
  const resolveBundleRoot = dependencies.resolveBundleRoot ?? resolveKnowledgeBundleRoot;
  const proposal = await prisma.okfRetrievalTriggerProposal.findFirst({
    where: {
      id: input.proposalId,
      knowledgeBundleId: input.knowledgeBundleId,
      status: "pending",
      workspaceId: input.context.workspaceId,
    },
  });
  if (!proposal) throw new Error("retrieval_trigger_proposal_not_found");

  if (input.decision === "reject") {
    const rejected = await prisma.okfRetrievalTriggerProposal.updateMany({
      data: {
        reviewedAt: new Date(),
        reviewedBy: input.context.userId,
        status: "rejected",
      },
      where: { id: proposal.id, status: "pending" },
    });
    if (rejected.count !== 1) throw new Error("retrieval_trigger_proposal_already_reviewed");
    return { status: "rejected" as const };
  }

  const terms = normalizeRetrievalTriggerTerms(input.terms ?? []);
  if (terms.length === 0) throw new Error("retrieval_trigger_terms_required");
  const normalizedFilePath = normalizeOkfTopicFilePath(proposal.targetFilePath);
  if (!normalizedFilePath || normalizedFilePath !== proposal.targetFilePath) {
    throw new Error("retrieval_trigger_target_path_invalid");
  }
  const bundle = await getBundle({
    bundleId: input.knowledgeBundleId,
    context: input.context,
  });
  if (!bundle || bundle.status !== "active") {
    throw new Error("knowledge_bundle_not_found");
  }
  const root = resolveBundleRoot({
    bundleId: bundle.id,
    workspaceId: input.context.workspaceId,
  });
  const file = await readBundleFile(root, normalizedFilePath);
  if (hashOkfSource(file.content) !== proposal.targetContentHash) {
    throw new Error("retrieval_trigger_target_changed");
  }
  const topic = await prisma.topicRecord.findFirst({
    select: { id: true },
    where: {
      exportedFilePath: normalizedFilePath,
      knowledgeBundleId: bundle.id,
      reviewStatus: "approved",
      workspaceId: input.context.workspaceId,
      document: {
        deletedAt: null,
        knowledgeBundleId: bundle.id,
        workspaceId: input.context.workspaceId,
      },
    },
  });
  if (!topic) throw new Error("retrieval_trigger_target_unavailable");

  const approved = await prisma.okfRetrievalTriggerProposal.updateMany({
    data: {
      approvedTerms: terms,
      reviewedAt: new Date(),
      reviewedBy: input.context.userId,
      status: "approved",
    },
    where: {
      id: proposal.id,
      status: "pending",
      targetContentHash: proposal.targetContentHash,
    },
  });
  if (approved.count !== 1) throw new Error("retrieval_trigger_proposal_already_reviewed");
  return { status: "approved" as const, terms };
}

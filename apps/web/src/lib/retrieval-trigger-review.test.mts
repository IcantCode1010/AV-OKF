import assert from "node:assert/strict";
import test from "node:test";

import type { AuthWorkspaceContext } from "./auth-workspace.ts";
import type { KnowledgeBundleRecord } from "./knowledge-bundles.ts";
import { hashOkfSource } from "./okf-concept-embedding-content.ts";
import { reviewRetrievalTriggerProposal } from "./retrieval-trigger-review.ts";

const context: AuthWorkspaceContext = {
  role: "member",
  userId: "user-1",
  workspaceId: "workspace-1",
};
const source = "---\ntype: procedure\ntitle: Brake System\n---\n\nApproved content.";
const proposal = {
  approvedTerms: [],
  createdAt: new Date(),
  fingerprint: "fingerprint-1",
  id: "proposal-1",
  knowledgeBundleId: "bundle-1",
  knowledgeGapId: "gap-1",
  matchReason: "Weak lexical match: brake",
  reviewedAt: null,
  reviewedBy: null,
  status: "pending",
  suggestedTerms: ["deceleration", "stopping"],
  targetContentHash: hashOkfSource(source),
  targetFilePath: "concepts/procedure/brake-system.md",
  targetTitle: "Brake System",
  updatedAt: new Date(),
  workspaceId: context.workspaceId,
};
const bundle = {
  activeProfileVersion: 1,
  createdAt: "2026-08-17T00:00:00.000Z",
  description: "Test bundle",
  documentCount: 1,
  id: "bundle-1",
  name: "Test bundle",
  okfVersion: "0.2",
  profile: {} as KnowledgeBundleRecord["profile"],
  slug: "test-bundle",
  status: "active",
  updatedAt: "2026-08-17T00:00:00.000Z",
  workspaceId: context.workspaceId,
} satisfies KnowledgeBundleRecord;

test("reviewed retrieval aliases require a current approved concept mapping", async () => {
  let updateData: Record<string, unknown> | undefined;
  const result = await reviewRetrievalTriggerProposal({
    context,
    decision: "approve",
    knowledgeBundleId: bundle.id,
    proposalId: proposal.id,
    terms: ["Stopping equipment", "deceleration"],
  }, dependencies({
    onUpdate: (data) => { updateData = data; },
  }));

  assert.deepEqual(result, {
    status: "approved",
    terms: ["deceleration", "stopping equipment"],
  });
  assert.deepEqual(updateData?.approvedTerms, ["deceleration", "stopping equipment"]);
  assert.equal(updateData?.status, "approved");
});

test("changed concept content prevents alias approval", async () => {
  await assert.rejects(
    () => reviewRetrievalTriggerProposal({
      context,
      decision: "approve",
      knowledgeBundleId: bundle.id,
      proposalId: proposal.id,
      terms: ["deceleration"],
    }, dependencies({ content: `${source}\nChanged.` })),
    /retrieval_trigger_target_changed/,
  );
});

test("rejecting an alias never reads or validates concept content", async () => {
  let readCalled = false;
  const result = await reviewRetrievalTriggerProposal({
    context,
    decision: "reject",
    knowledgeBundleId: bundle.id,
    proposalId: proposal.id,
  }, dependencies({
    readBundleFile: async () => {
      readCalled = true;
      throw new Error("must_not_read");
    },
  }));

  assert.deepEqual(result, { status: "rejected" });
  assert.equal(readCalled, false);
});

test("concurrent review allows exactly one pending-state transition", async () => {
  await assert.rejects(
    () => reviewRetrievalTriggerProposal({
      context,
      decision: "approve",
      knowledgeBundleId: bundle.id,
      proposalId: proposal.id,
      terms: ["deceleration"],
    }, dependencies({ updateCount: 0 })),
    /retrieval_trigger_proposal_already_reviewed/,
  );
});

function dependencies(options: {
  content?: string;
  onUpdate?: (data: Record<string, unknown>) => void;
  readBundleFile?: () => Promise<never>;
  updateCount?: number;
} = {}) {
  return {
    getBundle: async () => bundle,
    prisma: {
      okfRetrievalTriggerProposal: {
        findFirst: async () => proposal,
        updateMany: async ({ data }: { data: Record<string, unknown> }) => {
          options.onUpdate?.(data);
          return { count: options.updateCount ?? 1 };
        },
      },
      topicRecord: {
        findFirst: async () => ({ id: "topic-1" }),
      },
    } as never,
    readBundleFile: options.readBundleFile ?? (async () => ({
      content: options.content ?? source,
      filePath: proposal.targetFilePath,
    })),
    resolveBundleRoot: () => "C:/safe/bundle",
  };
}

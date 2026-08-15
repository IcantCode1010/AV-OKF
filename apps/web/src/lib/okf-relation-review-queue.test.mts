import assert from "node:assert/strict";
import test from "node:test";

import { getOkfRelationReviewQueue } from "./okf-relation-discovery.ts";

test("relation review queue keeps actionable rows complete and bounds rejection history", async () => {
  const queries: Array<Record<string, unknown>> = [];
  const prismaGlobal = globalThis as typeof globalThis & { avOkfPrisma?: unknown };
  const previous = prismaGlobal.avOkfPrisma;
  prismaGlobal.avOkfPrisma = {
    okfRelationCandidate: {
      findMany: async (query: Record<string, unknown>) => {
        queries.push(query);
        if (queries.length === 1) {
          return [{ id: "candidate-actionable", verificationStatus: "confirmed" }];
        }
        if (queries.length === 2) {
          return [{ id: "candidate-filtered", verificationStatus: "filtered" }];
        }
        return [{ id: "candidate-published", status: "approved" }];
      },
    },
  };

  try {
    const queue = await getOkfRelationReviewQueue({
      knowledgeBundleId: "bundle-1",
      workspaceId: "workspace-1",
    });

    assert.deepEqual(queue.actionable.map((candidate) => candidate.id), ["candidate-actionable"]);
    assert.deepEqual(queue.filtered.map((candidate) => candidate.id), ["candidate-filtered"]);
    assert.deepEqual(queue.published.map((candidate) => candidate.id), ["candidate-published"]);
    assert.equal(queries.length, 3);
    assert.equal(queries[0].take, undefined);
    assert.equal(queries[1].take, 50);
    assert.deepEqual(
      (queries[0].where as { verificationStatus: { in: string[] } }).verificationStatus.in,
      ["queued", "running", "confirmed", "failed"],
    );
    assert.equal(
      (queries[1].where as { verificationStatus: string }).verificationStatus,
      "filtered",
    );
    assert.equal(queries[2].take, 50);
    assert.deepEqual(queries[2].where, {
      automaticApprovalRequested: true,
      knowledgeBundleId: "bundle-1",
      status: "approved",
      workspaceId: "workspace-1",
    });
  } finally {
    if (previous === undefined) delete prismaGlobal.avOkfPrisma;
    else prismaGlobal.avOkfPrisma = previous;
  }
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyEvidenceSufficiency,
  resolveRagInvocationReason,
} from "./chat-evidence-sufficiency.ts";
import type { ChatRouterDecision } from "./chat-router.ts";

function decision(
  route: ChatRouterDecision["route"],
  requiresGraphTraversal = false,
): ChatRouterDecision {
  return {
    confidence: "high",
    constraints: {
      approvedOnly: route === "okf_only",
      includeUnreviewed: route !== "okf_only",
    },
    queryCategory: "policy_or_process",
    rationale: "test",
    requiredContext: [],
    requiresGraphTraversal,
    route,
  };
}

function retrieval(overrides: Record<string, unknown> = {}) {
  return {
    approvedOkfAvailable: false,
    citations: [],
    okfEvidenceMode: undefined,
    retrievalError: false,
    ...overrides,
  } as never;
}

test("qualified direct OKF is strong and does not invoke RAG", () => {
  const result = retrieval({
    approvedOkfAvailable: true,
    citations: [{ sourceType: "okf" }],
    okfEvidenceMode: "direct",
  });
  assert.deepEqual(
    classifyEvidenceSufficiency(result, decision("okf_only")),
    { status: "strong" },
  );
  assert.equal(
    resolveRagInvocationReason(result, decision("okf_only")),
    "not_invoked",
  );
});

test("hybrid OKF plus raw support is partial with a named gap", () => {
  const result = retrieval({
    approvedOkfAvailable: true,
    citations: [{ sourceType: "okf" }, { sourceType: "rag" }],
  });
  assert.deepEqual(
    classifyEvidenceSufficiency(result, decision("hybrid")),
    {
      namedGap: "supporting detail requested by the hybrid route",
      status: "partial",
    },
  );
  assert.equal(
    resolveRagInvocationReason(result, decision("hybrid")),
    "hybrid_supporting_context",
  );
});

test("graph-thin OKF is partial and raw-only evidence remains weak", () => {
  assert.equal(
    classifyEvidenceSufficiency(
      retrieval({
        approvedOkfAvailable: true,
        citations: [{ sourceType: "okf" }, { sourceType: "rag" }],
        okfEvidenceMode: "direct",
      }),
      decision("okf_only", true),
    ).status,
    "partial",
  );
  assert.equal(
    classifyEvidenceSufficiency(
      retrieval({ citations: [{ sourceType: "rag" }] }),
      decision("rag_only"),
    ).status,
    "weak",
  );
});

test("retrieval errors and honest misses are none", () => {
  assert.deepEqual(
    classifyEvidenceSufficiency(
      retrieval({ retrievalError: true }),
      decision("okf_only"),
    ),
    { reason: "retrieval_unavailable", status: "none" },
  );
  assert.deepEqual(
    classifyEvidenceSufficiency(retrieval(), decision("okf_only")),
    { reason: "no_supported_evidence_found", status: "none" },
  );
});

import assert from "node:assert/strict";
import test from "node:test";

import { buildAnswerEvidenceProfile } from "./chat-evidence-profile.ts";
import type { Stage6aRouterTrace } from "./chat-router.ts";
import type { ChatCitation } from "./chat-types.ts";

function citation(sourceType: "okf" | "rag", index = 1): ChatCitation {
  return {
    documentTitle: sourceType === "okf" ? "Approved Topic" : "Raw Manual",
    index,
    pageEnd: index,
    pageStart: index,
    sourceType,
    text: "Evidence excerpt.",
  };
}

function trace(
  overrides: Partial<Stage6aRouterTrace> = {},
): Partial<Stage6aRouterTrace> {
  return {
    confidence: "medium",
    constraints: { approvedOnly: false, includeUnreviewed: true },
    queryCategory: "canonical_definition",
    rationale: "test",
    requiredContext: [],
    retrievalToolsCalled: [],
    route: "okf_only",
    sourcesRead: [],
    stage: "router",
    ...overrides,
  };
}

test("OKF-only citations produce a high-trust approved OKF profile", () => {
  const profile = buildAnswerEvidenceProfile({
    citations: [citation("okf")],
    trace: trace({ finalEvidenceStatus: "approved_evidence" }),
  });

  assert.equal(profile.evidenceKind, "approved_okf");
  assert.equal(profile.trustLevel, "high");
  assert.deepEqual(profile.evidenceUsed, ["okf"]);
  assert.equal(profile.requiresUserVerification, false);
  assert.deepEqual(profile.sourceCounts, { okf: 1, rag: 0, total: 1 });
  assert.equal(profile.fallbackReason, undefined);
});

test("RAG-only citations produce a medium-trust raw RAG profile", () => {
  const profile = buildAnswerEvidenceProfile({
    citations: [citation("rag")],
    trace: trace({ finalEvidenceStatus: "discovery_evidence", route: "rag_only" }),
  });

  assert.equal(profile.evidenceKind, "raw_rag");
  assert.equal(profile.trustLevel, "medium");
  assert.deepEqual(profile.evidenceUsed, ["rag"]);
  assert.equal(profile.requiresUserVerification, true);
  assert.deepEqual(profile.sourceCounts, { okf: 0, rag: 1, total: 1 });
  assert.equal(profile.fallbackReason, undefined);
});

test("mixed citations produce a mixed profile with both source counts", () => {
  const profile = buildAnswerEvidenceProfile({
    citations: [citation("okf", 1), citation("rag", 2)],
    trace: trace({ finalEvidenceStatus: "approved_evidence", route: "hybrid" }),
  });

  assert.equal(profile.evidenceKind, "mixed");
  assert.equal(profile.trustLevel, "medium");
  assert.deepEqual(profile.evidenceUsed, ["okf", "rag"]);
  assert.equal(profile.requiresUserVerification, true);
  assert.deepEqual(profile.sourceCounts, { okf: 1, rag: 1, total: 2 });
});

test("no citations without retrieval error produces a blocked no-evidence profile", () => {
  const profile = buildAnswerEvidenceProfile({
    citations: [],
    trace: trace({ finalEvidenceStatus: "no_evidence", route: "okf_only" }),
  });

  assert.equal(profile.evidenceKind, "none");
  assert.equal(profile.trustLevel, "blocked");
  assert.deepEqual(profile.evidenceUsed, []);
  assert.equal(profile.requiresUserVerification, true);
  assert.deepEqual(profile.sourceCounts, { okf: 0, rag: 0, total: 0 });
  assert.match(profile.fallbackReason ?? "", /No approved OKF topics/i);
});

test("retrieval errors produce a blocked profile with unavailable retrieval reason", () => {
  const profile = buildAnswerEvidenceProfile({
    citations: [],
    trace: trace({ finalEvidenceStatus: "retrieval_error", route: "rag_only" }),
  });

  assert.equal(profile.evidenceKind, "none");
  assert.equal(profile.trustLevel, "blocked");
  assert.match(profile.fallbackReason ?? "", /Retrieval was unavailable/i);
});

test("OKF route with RAG fallback is raw RAG and not approved OKF", () => {
  const profile = buildAnswerEvidenceProfile({
    citations: [citation("rag")],
    trace: trace({
      finalEvidenceStatus: "discovery_evidence",
      ragUsedForDiscoveryOnly: true,
      route: "okf_only",
    }),
  });

  assert.equal(profile.evidenceKind, "raw_rag");
  assert.notEqual(profile.evidenceKind, "approved_okf");
  assert.match(profile.fallbackReason ?? "", /No approved OKF topic matched/i);
});

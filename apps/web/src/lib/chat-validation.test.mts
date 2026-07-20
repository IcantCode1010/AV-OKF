import assert from "node:assert/strict";
import test from "node:test";
import { validateChatAnswerEvidence } from "./chat-validation.ts";
import type { ChatCitation } from "./chat-types.ts";

function citation(sourceType: "okf" | "rag", index = 1): ChatCitation {
  return {
    documentTitle: "737NG AMM",
    index,
    pageEnd: 12,
    pageStart: 12,
    sourceType,
    text: "The system operates within the documented limits.",
  };
}

test("approved OKF evidence with a valid citation passes", () => {
  const result = validateChatAnswerEvidence({
    answerContent: "The system operates within the documented limits. [1]",
    citations: [citation("okf")],
    retrievalError: false,
    route: "okf_only",
  });

  assert.equal(result.status, "pass");
  assert.equal(result.safeAnswerMode, "release_as_written");
  assert.equal(result.profile.evidenceKind, "approved_okf");
});

test("a missing citation marker fails closed to cited evidence", () => {
  const result = validateChatAnswerEvidence({
    answerContent: "The system operates within the documented limits.",
    citations: [citation("rag")],
    retrievalError: false,
    route: "rag_only",
  });

  assert.equal(result.status, "fail");
  assert.equal(result.safeAnswerMode, "fallback_to_cited_evidence");
  assert.deepEqual(result.violations, ["answer_missing_valid_citation_marker"]);
});

test("OKF-only raw fallback must be explicitly labeled in the trace", () => {
  const result = validateChatAnswerEvidence({
    answerContent: "The source describes the system. [1]",
    citations: [citation("rag")],
    retrievalError: false,
    route: "okf_only",
    trace: { ragUsedForDiscoveryOnly: false },
  });

  assert.equal(result.status, "fail");
  assert.ok(result.violations.includes("raw_rag_used_without_okf_fallback_label"));
});

test("no evidence produces a blocked answer mode without inventing a citation", () => {
  const result = validateChatAnswerEvidence({
    answerContent: "No approved knowledge matched this question.",
    citations: [],
    retrievalError: false,
    route: "okf_only",
  });

  assert.equal(result.status, "pass");
  assert.equal(result.safeAnswerMode, "answer_with_missing_evidence");
  assert.equal(result.profile.evidenceKind, "none");
});

test("retrieval errors with no citations remain a safe no-evidence response", () => {
  const result = validateChatAnswerEvidence({
    answerContent: "Retrieval is temporarily unavailable.",
    citations: [],
    retrievalError: true,
    route: "hybrid",
    trace: { finalEvidenceStatus: "retrieval_error" },
  });

  assert.equal(result.status, "pass");
  assert.equal(result.profile.fallbackReason?.includes("unavailable"), true);
});

test("an explicit insufficient-evidence response may retain related sources without citing them", () => {
  const result = validateChatAnswerEvidence({
    answerContent: "Related material was found, but it is not enough to answer reliably.",
    answerOutcome: "insufficient_evidence",
    citations: [citation("okf")],
    retrievalError: false,
    route: "okf_only",
  });

  assert.equal(result.status, "pass");
  assert.equal(result.safeAnswerMode, "answer_with_missing_evidence");
});

test("insufficient-evidence responses cannot cite near-miss material as answer support", () => {
  const result = validateChatAnswerEvidence({
    answerContent: "The related source says this. [1]",
    answerOutcome: "insufficient_evidence",
    citations: [citation("okf")],
    retrievalError: false,
    route: "okf_only",
  });

  assert.equal(result.status, "fail");
  assert.deepEqual(result.violations, [
    "insufficient_evidence_must_not_cite_related_sources",
  ]);
});

import assert from "node:assert/strict";
import test from "node:test";

import { buildStage6aRouterReply, routeChatQuestion } from "./chat-router.ts";

test("routes official manual path questions to OKF", () => {
  const decision = routeChatQuestion(
    "What is the official manual path for REVERSER UNLOCKED IN FLIGHT?",
  );

  assert.equal(decision.route, "okf_only");
  assert.equal(decision.queryCategory, "source_lookup");
  assert.equal(decision.confidence, "high");
  assert.equal(decision.constraints.approvedOnly, true);
  assert.equal(decision.constraints.includeUnreviewed, false);
});

test("routes broad document mention searches to RAG", () => {
  const decision = routeChatQuestion(
    "Find all documents that mention ELT battery replacement.",
  );

  assert.equal(decision.route, "rag_only");
  assert.equal(decision.queryCategory, "open_ended_discovery");
  assert.equal(decision.confidence, "high");
  assert.equal(decision.constraints.approvedOnly, false);
  assert.equal(decision.constraints.includeUnreviewed, true);
});

test("routes official answers plus examples to hybrid", () => {
  const decision = routeChatQuestion(
    "What is the approved policy and show examples from the manuals?",
  );

  assert.equal(decision.route, "hybrid");
  assert.equal(decision.queryCategory, "comparison");
  assert.equal(decision.confidence, "medium");
});

test("routes vague dispatch questions to missing context", () => {
  const decision = routeChatQuestion("Can we dispatch?");

  assert.equal(decision.route, "missing_context");
  assert.equal(decision.queryCategory, "missing_context");
  assert.deepEqual(decision.requiredContext, [
    "aircraft_family",
    "effectivity",
    "source_authority",
    "operational_context",
  ]);
});

test("routes live data requests to unsupported", () => {
  const decision = routeChatQuestion("What is today's inventory count?");

  assert.equal(decision.route, "unsupported");
  assert.equal(decision.queryCategory, "live_or_fresh_data");
  assert.equal(decision.confidence, "high");
});

test("buildStage6aRouterReply asks for missing context instead of implying retrieval", () => {
  const decision = routeChatQuestion("What procedure should I use?");
  const reply = buildStage6aRouterReply(decision);

  assert.match(reply, /need a little more context/i);
  assert.match(reply, /aircraft family/i);
  assert.doesNotMatch(reply, /retrieval will be added/i);
});

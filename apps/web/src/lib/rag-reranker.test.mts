import assert from "node:assert/strict";
import test from "node:test";

import { rerankRawRagCandidates } from "./rag-reranker.ts";
import type { RetrievalResult } from "./rag-types.ts";

test("reranker orders scores, preserves stable ties, and drops relevance zero", async () => {
  const candidates = [result("a"), result("b"), result("c")];
  const reranked = await rerankRawRagCandidates(
    { candidates, query: "question", workspaceId: "w1" },
    dependencies([
      { chunkId: "a", relevance: 2, reason: "useful" },
      { chunkId: "b", relevance: 3, reason: "direct" },
      { chunkId: "c", relevance: 0, reason: "irrelevant" },
    ]),
  );
  assert.deepEqual(reranked.results.map((row) => row.chunkId), ["b", "a"]);
  assert.equal(reranked.trace.status, "applied");
  assert.equal(reranked.trace.dropped, 1);
});

test("reranker fails open for unknown, duplicate, or incomplete ids", async () => {
  const candidates = [result("a"), result("b")];
  for (const scores of [
    [{ chunkId: "a", relevance: 3, reason: "only one" }],
    [{ chunkId: "a", relevance: 3, reason: "one" }, { chunkId: "a", relevance: 2, reason: "duplicate" }],
    [{ chunkId: "a", relevance: 3, reason: "one" }, { chunkId: "unknown", relevance: 2, reason: "made up" }],
  ]) {
    const reranked = await rerankRawRagCandidates(
      { candidates, query: "question", workspaceId: "w1" },
      dependencies(scores),
    );
    assert.deepEqual(reranked.results.map((row) => row.chunkId), ["a", "b"]);
    assert.equal(reranked.trace.status, "malformed_response");
  }
});

test("missing key, budget exhaustion, and provider failure preserve RRF order", async () => {
  const candidates = [result("a"), result("b")];
  const missing = await rerankRawRagCandidates(
    { candidates, query: "q", workspaceId: "w1" },
    { getApiKey: async () => null },
  );
  assert.equal(missing.trace.status, "missing_key");
  const budget = await rerankRawRagCandidates(
    { candidates, query: "q", workspaceId: "w1" },
    { getApiKey: key, reserveCall: async () => false },
  );
  assert.equal(budget.trace.status, "budget_exceeded");
  const failure = await rerankRawRagCandidates(
    { candidates, query: "q", workspaceId: "w1" },
    { callProvider: async () => { throw new Error("down"); }, getApiKey: key, reserveCall: async () => true },
  );
  assert.equal(failure.trace.status, "provider_failed");
  assert.deepEqual(failure.results, candidates);
});

function dependencies(scores: unknown[]) {
  return {
    callProvider: async () => ({ scores }),
    getApiKey: key,
    reserveCall: async () => true,
  };
}

async function key() {
  return { apiKey: "test", provider: "openai" as const };
}

function result(chunkId: string): RetrievalResult {
  return {
    chunkId,
    coveredByOkfConceptIds: [],
    documentId: `doc-${chunkId}`,
    documentTitle: `Document ${chunkId}`,
    pageEnd: 1,
    pageStart: 1,
    retrievalMode: "hybrid",
    reviewStatus: "raw_extracted",
    score: 1,
    sourcePageNumbers: [1],
    sourceType: "raw_extraction",
    text: `chunk ${chunkId}`,
  };
}

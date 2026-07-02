import assert from "node:assert/strict";
import test from "node:test";

import { mergeHybridResults, retrieveDocuments } from "./rag-backend.ts";
import type { RetrievalResult } from "./rag-types.ts";

test("retrieveDocuments returns an empty local result set without production backend", async () => {
  const originalBackend = process.env.AV_OKF_BACKEND;
  process.env.AV_OKF_BACKEND = "local";

  try {
    const results = await retrieveDocuments({
      mode: "hybrid",
      query: "generator control",
      topK: 10,
      workspaceId: "wrk_1",
    });

    assert.deepEqual(results, []);
  } finally {
    process.env.AV_OKF_BACKEND = originalBackend;
  }
});

test("mergeHybridResults preserves review status on fused items", () => {
  const results = mergeHybridResults(
    [createRetrievalResult({ chunkId: "chunk_keyword", reviewStatus: "raw_extracted" })],
    [createRetrievalResult({ chunkId: "chunk_vector", reviewStatus: "raw_extracted" })],
    10,
  );

  assert.deepEqual(
    results.map((result) => result.reviewStatus),
    ["raw_extracted", "raw_extracted"],
  );
});

function createRetrievalResult(
  overrides: Partial<RetrievalResult>,
): RetrievalResult {
  return {
    chunkId: "chunk_1",
    coveredByOkfConceptIds: [],
    documentId: "doc_1",
    documentTitle: "Generator Manual",
    pageEnd: 1,
    pageStart: 1,
    retrievalMode: "keyword",
    reviewStatus: "raw_extracted",
    score: 1,
    sourcePageNumbers: [1],
    text: "Generator control unit.",
    ...overrides,
  };
}

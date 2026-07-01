import assert from "node:assert/strict";
import test from "node:test";

import {
  createDeterministicEmbeddingProvider,
  getEmbeddingProvider,
} from "./embedding-provider.ts";

test("deterministic embedding provider returns stable vectors", async () => {
  const provider = createDeterministicEmbeddingProvider();
  const first = await provider.embedTexts(["generator control unit"]);
  const second = await provider.embedTexts(["generator control unit"]);

  assert.equal(provider.model, "deterministic-test-embedding");
  assert.equal(provider.dimensions, 1536);
  assert.deepEqual(first, second);
  assert.equal(first[0]?.length, 1536);
});

test("getEmbeddingProvider uses deterministic provider outside production", () => {
  const originalBackend = process.env.AV_OKF_BACKEND;
  const originalKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  process.env.AV_OKF_BACKEND = "local";

  try {
    const provider = getEmbeddingProvider();

    assert.equal(provider.model, "deterministic-test-embedding");
  } finally {
    process.env.AV_OKF_BACKEND = originalBackend;
    process.env.OPENAI_API_KEY = originalKey;
  }
});

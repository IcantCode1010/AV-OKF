import assert from "node:assert/strict";
import test from "node:test";

import {
  createHeuristicTokenCounter,
  createTiktokenTokenCounter,
  getTokenCounter,
} from "./rag-tokenizer.ts";

test("heuristic token counter is available for deterministic local tests", () => {
  const counter = createHeuristicTokenCounter();

  assert.equal(counter.kind, "heuristic");
  assert.equal(counter.count("ATA 24 generator-control unit"), 6);
});

test("tiktoken token counter handles technical strings without word heuristics", () => {
  const counter = createTiktokenTokenCounter();
  const technical = "ATA-24 GCU P/N 1159SCL402-17 GEN-OFF-BUS";

  assert.equal(counter.kind, "tiktoken");
  assert.equal(counter.count(technical) > technical.split(/\s+/).length, true);
});

test("getTokenCounter uses tiktoken in production embedding path", () => {
  const originalBackend = process.env.AV_OKF_BACKEND;
  process.env.AV_OKF_BACKEND = "production";

  try {
    const counter = getTokenCounter();

    assert.equal(counter.kind, "tiktoken");
  } finally {
    process.env.AV_OKF_BACKEND = originalBackend;
  }
});

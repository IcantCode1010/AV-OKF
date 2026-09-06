import assert from "node:assert/strict";
import test from "node:test";
import { acceptResearchToolResult } from "./research-tool-result.ts";

test("a rejected page cannot enter the inspected-evidence registry", () => {
  const registry = new Map();
  const prior = { id: "prior", quote: "Already delivered" };
  const rejected = { id: "rejected", quote: "Never delivered" };
  acceptResearchToolResult(prior, 1000, (value) => registry.set(value.id, value));
  assert.throws(() => acceptResearchToolResult(rejected, 1, (value) => registry.set(value.id, value)), /research_budget_exhausted/);
  assert.deepEqual([...registry.keys()], ["prior"]);
});

test("accounts for the complete serialized response and accepts the exact boundary", () => {
  const result = { quote: "A passage", nextOffset: 6000 };
  const size = JSON.stringify(result).length;
  let commits = 0;
  assert.equal(acceptResearchToolResult(result, size, () => commits++), size);
  assert.equal(commits, 1);
  assert.throws(() => acceptResearchToolResult(result, size - 1, () => commits++), /research_budget_exhausted/);
  assert.equal(commits, 1);
});

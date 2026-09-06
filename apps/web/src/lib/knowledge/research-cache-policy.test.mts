import assert from "node:assert/strict";
import test from "node:test";
import { shouldRefreshResearchCache } from "./research-cache-policy.ts";

test("changed source scope and stale passages request a fresh research run", () => {
  for (const code of ["knowledge_sources_changed", "knowledge_scope_changed", "knowledge_evidence_unavailable", "knowledge_graph_changed"])
    assert.equal(shouldRefreshResearchCache(new Error(code)), true);
});
test("access, cancellation and infrastructure errors cannot fall through cache validation", () => {
  for (const error of [new Error("knowledge_access_denied"), new Error("research_cancelled"),
    new Error("knowledge_source_unavailable"), new Error("database_unavailable"), "knowledge_sources_changed"])
    assert.equal(shouldRefreshResearchCache(error), false);
});

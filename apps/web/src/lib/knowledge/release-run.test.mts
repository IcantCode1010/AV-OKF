import assert from "node:assert/strict";
import test from "node:test";
import { KNOWLEDGE_RELEASE_STAGES, nextKnowledgeReleaseStage } from "./release-run.ts";

test("release stages are ordered from review gate through explicit activation", () => {
  assert.deepEqual(KNOWLEDGE_RELEASE_STAGES, ["gate_selection", "classify", "compile_navigation", "build_package", "upload", "import", "verify", "activate"]);
});

test("resumption starts after the last completed idempotent stage", () => {
  assert.equal(nextKnowledgeReleaseStage([]), "gate_selection");
  assert.equal(nextKnowledgeReleaseStage(["gate_selection", "classify"]), "compile_navigation");
  assert.equal(nextKnowledgeReleaseStage(KNOWLEDGE_RELEASE_STAGES), null);
});

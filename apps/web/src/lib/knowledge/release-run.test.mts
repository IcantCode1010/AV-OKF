import assert from "node:assert/strict";
import test from "node:test";
import { KNOWLEDGE_RELEASE_STAGES, nextKnowledgeReleaseStage, verifyAdditiveEfbRelease } from "./release-run.ts";

test("release stages are ordered from review gate through explicit activation", () => {
  assert.deepEqual(KNOWLEDGE_RELEASE_STAGES, ["gate_selection", "classify", "compile_navigation", "build_package", "upload", "import", "verify", "activate"]);
});

test("existing package skips rebuilding but still checks approval before upload", () => {
  assert.equal(nextKnowledgeReleaseStage(["compile_navigation", "build_package"]), "gate_selection");
  assert.equal(nextKnowledgeReleaseStage(["gate_selection", "classify", "compile_navigation", "build_package"]), "upload");
});

test("additive publication inspects the candidate and retains its previous catalog", async () => {
  const actions: string[] = [];
  const result = await verifyAdditiveEfbRelease(async input => {
    actions.push(String(input.action));
    return input.action === "prepare-additive" ? { revisionId: "new", previousRevisionId: "old" } : { packages: [{ package_version_id: "airbus@1" }, { package_version_id: "boeing@1" }] };
  }, "airbus@1");
  assert.equal(result.previousRevisionId, "old");
  assert.deepEqual(actions, ["prepare-additive", "inspect"]);
});

test("publication rejects a candidate missing the requested package", async () => {
  await assert.rejects(verifyAdditiveEfbRelease(async input => input.action === "prepare-additive" ? { revisionId: "new", previousRevisionId: null } : { packages: [] }, "airbus@1"), /inspection_mismatch/);
});

test("resumption starts after the last completed idempotent stage", () => {
  assert.equal(nextKnowledgeReleaseStage([]), "gate_selection");
  assert.equal(nextKnowledgeReleaseStage(["gate_selection", "classify"]), "compile_navigation");
  assert.equal(nextKnowledgeReleaseStage(KNOWLEDGE_RELEASE_STAGES), null);
});

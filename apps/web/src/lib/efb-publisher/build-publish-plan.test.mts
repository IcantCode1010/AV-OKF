import assert from "node:assert/strict";
import test from "node:test";
import { buildPublishPlan } from "./build-publish-plan.ts";
import { importEfbPackage, rollbackEfbRelease, verifyEfbRelease } from "./publish-package.ts";

test("dry-run plan describes the receiver saga and keeps activation explicit", () => {
  const staged = buildPublishPlan("package@1.0.0", 12, false);
  assert.deepEqual(staged.steps.map((step) => step.action), ["initialize", "upload", "validate", "complete", "prepare", "inspect"]);
  assert.equal(staged.activate, false);
  const activated = buildPublishPlan("package@1.0.0", 12, true);
  assert.equal(activated.steps.at(-1)?.action, "activate");
});

test("rollback only activates an already retained receiver revision", async () => {
  const calls: Record<string, unknown>[] = [];
  await rollbackEfbRelease(async (body) => { calls.push(body); return { ok: true }; }, "11111111-1111-1111-1111-111111111111");
  assert.deepEqual(calls, [{ action: "activate", revision: "11111111-1111-1111-1111-111111111111" }]);
});

test("import batches validation and completes resumably", async () => {
  const calls: Record<string, unknown>[] = [];
  let completion = 0;
  await importEfbPackage(async (body) => {
    calls.push(body);
    if (body.action === "complete") return { state: completion++ ? "validated" : "registering-assets" };
    return {};
  }, "package@1.0.0", Array.from({ length: 11 }, (_, index) => index === 0 ? "native/catalog.json" : `artifact-${index}`));
  assert.equal(calls.filter((call) => call.action === "validate").length, 3);
  assert.equal(calls.filter((call) => call.action === "complete").length, 2);
});

test("verification prepares then inspects one receiver revision", async () => {
  const calls: Record<string, unknown>[] = [];
  const result = await verifyEfbRelease(async (body) => {
    calls.push(body);
    return body.action === "prepare"
      ? "11111111-1111-1111-1111-111111111111"
      : { state: "candidate" };
  }, "package@1.0.0");
  assert.equal(result.revisionId, "11111111-1111-1111-1111-111111111111");
  assert.deepEqual(calls.map((call) => call.action), ["prepare", "inspect"]);
});

import assert from "node:assert/strict";
import test from "node:test";

import { buildBundleManifest, resolveKnowledgeBundleRoot } from "./knowledge-bundles.ts";
import { getKnowledgeProfileTemplate, getTypeDirectory, validateKnowledgeProfile } from "./knowledge-profile.ts";

test("generic and aviation profiles share the base contract without leaking aviation requirements", () => {
  const generic = getKnowledgeProfileTemplate("generic");
  const aviation = getKnowledgeProfileTemplate("aviation");
  assert.deepEqual(validateKnowledgeProfile(generic), []);
  assert.equal(generic.fields.type.required, true);
  assert.equal(generic.fields.aircraft_family, undefined);
  assert.equal(generic.fields.covered_rag_chunk_ids?.type, "string_array");
  assert.equal(generic.fields.classification_code?.type, "string");
  assert.equal(aviation.fields.aircraft_family?.required, undefined);
  assert.equal(getTypeDirectory(generic, "procedure"), "procedures/procedure");
});

test("bundle manifest makes only profile-required fields required", () => {
  const profile = getKnowledgeProfileTemplate("generic");
  profile.fields.department = { required: true, type: "string" };
  const manifest = buildBundleManifest(profile);
  assert.match(manifest, /required:\n      - type\n      - department/);
  assert.match(manifest, /optional:[\s\S]*- title/);
  assert.match(manifest, /date_fields:\n  - updated/);
});

test("workspace bundle roots are isolated and server-generated segments are path-safe", () => {
  const first = resolveKnowledgeBundleRoot({ bundleId: "kb_general", knowledgeRoot: "C:/vault", workspaceId: "wrk_1" });
  const second = resolveKnowledgeBundleRoot({ bundleId: "kb_cars", knowledgeRoot: "C:/vault", workspaceId: "wrk_1" });
  assert.notEqual(first, second);
  assert.throws(() => resolveKnowledgeBundleRoot({ bundleId: "../escape", knowledgeRoot: "C:/vault", workspaceId: "wrk_1" }), /storage_key_invalid/);
});

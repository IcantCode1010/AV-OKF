import assert from "node:assert/strict";
import test from "node:test";

import { buildBundleManifest, resolveKnowledgeBundleRoot } from "./knowledge-bundles.ts";
import {
  getKnowledgeProfileTemplate,
  getTypeDirectory,
  normalizeKnowledgeProfile,
  validateKnowledgeProfile,
} from "./knowledge-profile.ts";

test("generic and aviation profiles share the base contract without leaking aviation requirements", () => {
  const generic = getKnowledgeProfileTemplate("generic");
  const aviation = getKnowledgeProfileTemplate("aviation");
  assert.deepEqual(validateKnowledgeProfile(generic), []);
  assert.equal(generic.fields.type.required, true);
  assert.equal(generic.fields.aircraft_family, undefined);
  assert.equal(generic.fields.covered_rag_chunk_ids?.type, "string_array");
  assert.equal(generic.fields.classification_code?.type, "string");
  assert.equal(aviation.fields.aircraft_family?.required, undefined);
  assert.deepEqual(aviation.clarificationFields, [
    "subject_family",
    "classification_code",
    "document_type",
    "tags",
  ]);
  assert.equal(getTypeDirectory(generic, "procedure"), "procedures/procedure");
});

test("profile clarification fields reject unsafe, unknown, duplicate, and unsupported fields", () => {
  const profile = getKnowledgeProfileTemplate("generic");
  profile.fields.internal_list = { type: "number_array" };
  profile.clarificationFields = [
    "source_authority",
    "missing_field",
    "tags",
    "tags",
    "internal_list",
  ];

  assert.deepEqual(validateKnowledgeProfile(profile), [
    "knowledge_profile_clarification_field_prohibited:source_authority",
    "knowledge_profile_clarification_field_unknown:missing_field",
    "knowledge_profile_clarification_field_duplicate:tags",
    "knowledge_profile_clarification_field_type_unsupported:internal_list",
  ]);
});

test("legacy built-in profiles gain safe defaults while legacy custom profiles fail closed", () => {
  const builtIn = getKnowledgeProfileTemplate("generic") as Partial<
    ReturnType<typeof getKnowledgeProfileTemplate>
  > & Omit<ReturnType<typeof getKnowledgeProfileTemplate>, "clarificationFields">;
  const custom = {
    ...getKnowledgeProfileTemplate("generic"),
    id: "custom-1",
  } as Partial<ReturnType<typeof getKnowledgeProfileTemplate>> &
    Omit<ReturnType<typeof getKnowledgeProfileTemplate>, "clarificationFields">;
  delete builtIn.clarificationFields;
  delete custom.clarificationFields;

  assert.deepEqual(
    normalizeKnowledgeProfile(builtIn as ReturnType<typeof getKnowledgeProfileTemplate>)
      .clarificationFields,
    ["subject_family", "classification_code", "document_type", "tags"],
  );
  assert.deepEqual(
    normalizeKnowledgeProfile(custom as ReturnType<typeof getKnowledgeProfileTemplate>)
      .clarificationFields,
    [],
  );
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

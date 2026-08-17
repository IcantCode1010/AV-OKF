import assert from "node:assert/strict";
import test from "node:test";

import {
  isAgentReadyOkfMetadata,
  validateGenericOkfMetadata,
} from "./okf-generic-metadata.ts";

test("generic OKF accepts type as the only required field", () => {
  assert.deepEqual(validateGenericOkfMetadata({ type: "policy" }), {
    metadata: { type: "policy" },
    valid: true,
  });
});

test("generic OKF accepts descriptive multiword and unknown types", () => {
  assert.deepEqual(validateGenericOkfMetadata({ type: " BigQuery Table " }), {
    metadata: { type: "BigQuery Table" },
    valid: true,
  });
  assert.deepEqual(validateGenericOkfMetadata({ type: "Custom Producer Type" }), {
    metadata: { type: "Custom Producer Type" },
    valid: true,
  });
});

test("generic OKF normalizes optional fields", () => {
  assert.deepEqual(
    validateGenericOkfMetadata({
      description: " A procedure. ",
      tags: ["vehicle", "vehicle", "inspection"],
      title: " Pre-start inspection ",
      type: "procedure",
      resource: "urn:example:inspection",
    }),
    {
      metadata: {
        description: "A procedure.",
        tags: ["vehicle", "inspection"],
        title: "Pre-start inspection",
        type: "procedure",
        resource: "urn:example:inspection",
      },
      valid: true,
    },
  );
});

test("generic OKF rejects missing type, invalid tags, and stale date", () => {
  const result = validateGenericOkfMetadata({
    tags: ["valid", " "],
    type: " ",
    stale_after: "2026-02-31",
  });
  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.deepEqual(result.errors, [
      "generic_okf_type_required",
      "generic_okf_tags_invalid",
      "okf_v02_stale_after_invalid",
    ].sort((a, b) => result.errors.indexOf(a) - result.errors.indexOf(b)));
  }
});

test("generic validity does not imply trusted agent evidence", () => {
  assert.equal(isAgentReadyOkfMetadata({ type: "policy" }, "Policy text"), false);
  assert.equal(
    isAgentReadyOkfMetadata(
      {
        status: "stable",
        verified: [{ by: "human:reviewer", at: "2026-07-20T12:00:00.000Z" }],
        sources: [{ resource: "/references/sources/manual.md" }],
        source_pages: [2, 3],
        title: "Inspection",
        type: "procedure",
      },
      "Inspection text",
    ),
    true,
  );
});

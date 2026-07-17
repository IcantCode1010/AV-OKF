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

test("generic OKF normalizes optional fields", () => {
  assert.deepEqual(
    validateGenericOkfMetadata({
      description: " A procedure. ",
      tags: ["vehicle", "vehicle", "inspection"],
      title: " Pre-start inspection ",
      type: "procedure",
      updated: "2026-07-15",
    }),
    {
      metadata: {
        description: "A procedure.",
        tags: ["vehicle", "inspection"],
        title: "Pre-start inspection",
        type: "procedure",
        updated: "2026-07-15",
      },
      valid: true,
    },
  );
});

test("generic OKF rejects invalid type, tags, and updated date", () => {
  const result = validateGenericOkfMetadata({
    tags: ["valid", " "],
    type: "../policy",
    updated: "2026-02-31",
  });
  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.deepEqual(result.errors, [
      "generic_okf_type_invalid",
      "generic_okf_updated_invalid",
      "generic_okf_tags_invalid",
    ].sort((a, b) => result.errors.indexOf(a) - result.errors.indexOf(b)));
  }
});

test("generic validity does not imply trusted agent evidence", () => {
  assert.equal(isAgentReadyOkfMetadata({ type: "policy" }, "Policy text"), false);
  assert.equal(
    isAgentReadyOkfMetadata(
      {
        review_status: "approved",
        source_authority: "Manufacturer",
        source_file: "manual.pdf",
        source_pages: [2, 3],
        title: "Inspection",
        type: "procedure",
      },
      "Inspection text",
    ),
    true,
  );
});

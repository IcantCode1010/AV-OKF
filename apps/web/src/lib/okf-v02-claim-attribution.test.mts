import assert from "node:assert/strict";
import test from "node:test";

import { inspectOkfV02ClaimAttribution } from "./okf-v02-claim-attribution.ts";

test("claim attribution joins exact footnote labels to source ids", () => {
  const result = inspectOkfV02ClaimAttribution({
    body: `The limit is 30 minutes.[^policy]\n\n[^policy]: Operations policy\n`,
    sources: [{ id: "policy", resource: "references/policy.md" }],
  });

  assert.deepEqual(result, {
    definitions: ["policy"],
    issues: [],
    matchedReferenceCount: 1,
    references: ["policy"],
    sourceIds: ["policy"],
  });
});

test("claim attribution reports missing sources and definitions independently", () => {
  const result = inspectOkfV02ClaimAttribution({
    body: `One claim.[^missing-source]\nAnother.[^missing-definition]\n\n[^missing-source]: Source\n`,
    sources: [{ id: "missing-definition", resource: "references/source.md" }],
  });

  assert.deepEqual(
    result.issues.map((issue) => [issue.code, issue.label]),
    [
      ["okf_v02_claim_footnote_definition_missing", "missing-definition"],
      ["okf_v02_claim_source_missing", "missing-source"],
    ],
  );
  assert.equal(result.matchedReferenceCount, 0);
});

test("claim attribution fails closed on ambiguous ids and definitions", () => {
  const result = inspectOkfV02ClaimAttribution({
    body: `Claim.[^policy]\n\n[^policy]: First\n[^policy]: Second\n`,
    sources: [
      { id: "policy", resource: "references/one.md" },
      { id: "policy", resource: "references/two.md" },
    ],
  });

  assert.deepEqual(
    result.issues.map((issue) => issue.code),
    [
      "okf_v02_claim_footnote_definition_duplicate",
      "okf_v02_claim_source_id_duplicate",
    ],
  );
  assert.equal(result.matchedReferenceCount, 0);
});

test("claim attribution ignores examples, inline code, indented code, and escapes", () => {
  const result = inspectOkfV02ClaimAttribution({
    body: [
      "```md",
      "Example.[^fenced]",
      "```not-a-closing-fence",
      "Still fenced.[^also-fenced]",
      "[^fenced]: Example",
      "```",
      "`Example.[^inline]`",
      "    Example.[^indented]",
      String.raw`Escaped.\[^escaped]`,
      "Real claim.[^real]",
      "",
      "[^real]: Real source",
    ].join("\n"),
    sources: [{ id: "real", resource: "references/real.md" }],
  });

  assert.deepEqual(result.references, ["real"]);
  assert.deepEqual(result.definitions, ["real"]);
  assert.deepEqual(result.issues, []);
});

test("claim attribution uses exact case-sensitive source ids", () => {
  const result = inspectOkfV02ClaimAttribution({
    body: `Claim.[^Policy]\n\n[^Policy]: Policy\n`,
    sources: [{ id: "policy", resource: "references/policy.md" }],
  });

  assert.deepEqual(
    result.issues.map((issue) => [issue.code, issue.label]),
    [["okf_v02_claim_source_missing", "Policy"]],
  );
});

test("declared sources do not require claim footnotes", () => {
  const result = inspectOkfV02ClaimAttribution({
    body: "A concept can derive from a source without attributing individual claims.\n",
    sources: [{ id: "source", resource: "references/source.md" }],
  });

  assert.deepEqual(result.issues, []);
  assert.equal(result.matchedReferenceCount, 0);
});

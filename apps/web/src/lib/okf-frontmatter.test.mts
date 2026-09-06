import assert from "node:assert/strict";
import test from "node:test";

import {
  getFrontmatterNumberArray,
  getFrontmatterRelations,
  getFrontmatterScalar,
  getFrontmatterStringArray,
  isOkfV02Current,
  parseOkfMarkdown,
  serializeOkfMarkdown,
} from "./okf-frontmatter.ts";

test("current lifecycle treats absent status as stable and compares exact instants", () => {
  const staleAfter = "2026-08-24T12:00:00-04:00";
  assert.equal(isOkfV02Current({}, new Date("2026-08-24T15:59:59Z")), true);
  assert.equal(isOkfV02Current({ stale_after: staleAfter }, new Date("2026-08-24T15:59:59Z")), true);
  assert.equal(isOkfV02Current({ stale_after: staleAfter }, new Date("2026-08-24T16:00:00Z")), false);
  assert.equal(isOkfV02Current({ status: "draft" }), false);
  assert.equal(isOkfV02Current({ stale_after: "2026-08-25" }), false);
});

test("parseOkfMarkdown parses scalar fields written by the OKF exporter", () => {
  const parsed = parseOkfMarkdown(
    [
      "---",
      'type: "system_topic"',
      "review_status: approved",
      'title: "Main Gear Brake System"',
      "---",
      "",
      "# Body",
    ].join("\n"),
  );

  assert.equal(getFrontmatterScalar(parsed.frontmatter, "type"), "system_topic");
  assert.equal(getFrontmatterScalar(parsed.frontmatter, "review_status"), "approved");
  assert.equal(
    getFrontmatterScalar(parsed.frontmatter, "title"),
    "Main Gear Brake System",
  );
});

test("parseOkfMarkdown parses source_pages arrays", () => {
  const parsed = parseOkfMarkdown(
    [
      "---",
      "source_pages:",
      "  - 41",
      "  - 42",
      "  - 43",
      "---",
      "",
    ].join("\n"),
  );

  assert.deepEqual(getFrontmatterStringArray(parsed.frontmatter, "source_pages"), [
    "41",
    "42",
    "43",
  ]);
  assert.deepEqual(getFrontmatterNumberArray(parsed.frontmatter, "source_pages"), [
    41,
    42,
    43,
  ]);
});

test("parseOkfMarkdown parses covered_rag_chunk_ids arrays", () => {
  const parsed = parseOkfMarkdown(
    [
      "---",
      "covered_rag_chunk_ids:",
      "  - chunk_1",
      "  - chunk_2",
      'coverage_type: "direct_source"',
      "---",
    ].join("\n"),
  );

  assert.deepEqual(getFrontmatterStringArray(parsed.frontmatter, "covered_rag_chunk_ids"), [
    "chunk_1",
    "chunk_2",
  ]);
  assert.equal(
    getFrontmatterScalar(parsed.frontmatter, "coverage_type"),
    "direct_source",
  );
});

test("parseOkfMarkdown parses typed relations blocks", () => {
  const parsed = parseOkfMarkdown(
    [
      "---",
      "relations:",
      '  - relation: "routes_to"',
      '    target: "32-main-gear.md"',
      '    target_type: "system_topic"',
      '    reason: "Dispatch questions route here."',
      "---",
    ].join("\n"),
  );

  assert.deepEqual(getFrontmatterRelations(parsed.frontmatter), [
    {
      relation: "routes_to",
      target: "32-main-gear.md",
      targetType: "system_topic",
      reason: "Dispatch questions route here.",
    },
  ]);
});

test("parseOkfMarkdown returns body content separately from frontmatter", () => {
  const parsed = parseOkfMarkdown(
    ["---", 'title: "Topic"', "---", "", "# Topic", "", "Body text."].join("\n"),
  );

  assert.equal(parsed.body, "# Topic\n\nBody text.");
});

test("parseOkfMarkdown with no frontmatter block returns the full text as body", () => {
  const parsed = parseOkfMarkdown("# Topic\n\nBody text with no frontmatter.");

  assert.deepEqual(parsed.frontmatter, {});
  assert.equal(parsed.body, "# Topic\n\nBody text with no frontmatter.");
});

test("parseOkfMarkdown with an unterminated frontmatter block does not throw", () => {
  const parsed = parseOkfMarkdown(
    ["---", 'title: "Topic"', "review_status: approved", "", "# Topic"].join("\n"),
  );

  assert.deepEqual(parsed.frontmatter, {});
  assert.equal(
    parsed.body,
    ["---", 'title: "Topic"', "review_status: approved", "", "# Topic"].join("\n"),
  );
});

test("parseOkfMarkdown parses scalar and list keys independently in the same block", () => {
  const parsed = parseOkfMarkdown(
    [
      "---",
      'title: "Topic"',
      "source_pages:",
      "  - 41",
      "  - 42",
      'type: "system_topic"',
      "tags:",
      "  - brakes",
      'review_status: "approved"',
      "---",
    ].join("\n"),
  );

  assert.equal(getFrontmatterScalar(parsed.frontmatter, "title"), "Topic");
  assert.equal(getFrontmatterScalar(parsed.frontmatter, "type"), "system_topic");
  assert.equal(
    getFrontmatterScalar(parsed.frontmatter, "review_status"),
    "approved",
  );
  assert.deepEqual(getFrontmatterStringArray(parsed.frontmatter, "source_pages"), [
    "41",
    "42",
  ]);
  assert.deepEqual(getFrontmatterStringArray(parsed.frontmatter, "tags"), ["brakes"]);
});

test("getFrontmatterRelations defaults a missing reason to an empty string", () => {
  const parsed = parseOkfMarkdown(
    [
      "---",
      "relations:",
      '  - relation: "references"',
      '    target: "32-main-gear.md"',
      '    target_type: "system_topic"',
      "---",
    ].join("\n"),
  );

  assert.deepEqual(getFrontmatterRelations(parsed.frontmatter), [
    {
      relation: "references",
      target: "32-main-gear.md",
      targetType: "system_topic",
      reason: "",
    },
  ]);
});

test("an empty list key parses as an empty array, not a parse error", () => {
  const parsed = parseOkfMarkdown(
    ["---", "tags:", 'title: "Topic"', "---"].join("\n"),
  );

  assert.deepEqual(getFrontmatterStringArray(parsed.frontmatter, "tags"), []);
  assert.equal(getFrontmatterScalar(parsed.frontmatter, "title"), "Topic");
});

test("v0.2 nested provenance and unknown extensions survive a round trip", () => {
  const parsed = parseOkfMarkdown([
    "---",
    "type: procedure",
    "status: stable",
    "generated:",
    "  by: av-okf/enrichment",
    "  at: 2026-08-06T12:00:00.000Z",
    "verified:",
    "  by: human:reviewer-1",
    "  at: 2026-08-06T12:01:00.000Z",
    "sources:",
    "  - id: source-abc",
    "    resource: /references/sources/manual-abc.md",
    "x_custom:",
    "  nested: true",
    "---",
    "",
    "Body",
  ].join("\n"));
  const roundTrip = parseOkfMarkdown(serializeOkfMarkdown(parsed));
  assert.deepEqual(roundTrip.frontmatter.x_custom, { nested: true });
  assert.deepEqual(roundTrip.frontmatter.verified, {
    at: "2026-08-06T12:01:00.000Z",
    by: "human:reviewer-1",
  });
  assert.equal(roundTrip.body.trim(), "Body");
});

test("parser rejects duplicate keys and YAML aliases", () => {
  assert.throws(
    () => parseOkfMarkdown("---\ntype: policy\ntype: procedure\n---\n"),
    /okf_frontmatter_invalid/,
  );
  assert.throws(
    () => parseOkfMarkdown("---\ntype: &kind procedure\ntitle: *kind\n---\n"),
    /okf_frontmatter_alias_not_allowed/,
  );
});

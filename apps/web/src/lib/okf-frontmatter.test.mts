import assert from "node:assert/strict";
import test from "node:test";

import {
  getFrontmatterNumberArray,
  getFrontmatterRelations,
  getFrontmatterScalar,
  getFrontmatterStringArray,
  parseOkfMarkdown,
} from "./okf-frontmatter.ts";

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

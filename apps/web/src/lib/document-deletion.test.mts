import assert from "node:assert/strict";
import test from "node:test";

import {
  citationsReferenceDocument,
  DELETED_CHAT_ANSWER,
  replaceRelationsBlock,
} from "./document-deletion.ts";
import { getFrontmatterRelations, parseOkfMarkdown } from "./okf-frontmatter.ts";

test("raw, OKF, and mixed citations identify document-derived answers", () => {
  assert.equal(
    citationsReferenceDocument(
      [{ documentId: "doc_1", okfFilePath: null, sourceType: "rag" }],
      "doc_1",
      ["concepts/procedure/topic-a.md"],
    ),
    true,
  );
  assert.equal(
    citationsReferenceDocument(
      [{ okfFilePath: "concepts/procedure/topic-a.md", sourceType: "okf" }],
      "doc_1",
      ["concepts/procedure/topic-a.md"],
    ),
    true,
  );
  assert.equal(
    citationsReferenceDocument(
      [
        { documentId: "doc_2", sourceType: "rag" },
        { documentId: "doc_1", sourceType: "rag" },
      ],
      "doc_1",
      [],
    ),
    true,
  );
  assert.equal(
    citationsReferenceDocument(
      [{ documentId: "doc_2", sourceType: "rag" }],
      "doc_1",
      ["concepts/procedure/topic-a.md"],
    ),
    false,
  );
  assert.match(DELETED_CHAT_ANSWER, /supporting source was permanently deleted/);
});

test("relation cleanup removes deleted targets while preserving content", () => {
  const markdown = `---
type: procedure
title: Surviving concept
updated: 2026-07-19
relations:
  - relation: "routes_to"
    target: "deleted.md"
    target_type: "procedure"
    reason: "Removed target"
  - relation: "supports"
    target: "kept.md"
    target_type: "procedure"
    reason: "Keep this"
---

# Surviving concept

Body content remains unchanged.
`;
  const relations = getFrontmatterRelations(parseOkfMarkdown(markdown).frontmatter);
  const updated = replaceRelationsBlock(markdown, [relations[1]!], "2026-07-21T01:00:00.000Z");
  const parsed = parseOkfMarkdown(updated);

  assert.equal(parsed.body, "# Surviving concept\n\nBody content remains unchanged.\n");
  assert.equal(parsed.frontmatter.updated, "2026-07-21");
  assert.deepEqual(getFrontmatterRelations(parsed.frontmatter), [relations[1]]);
  assert.doesNotMatch(updated, /deleted\.md/);
});

test("relation cleanup can remove the entire relation block", () => {
  const markdown = `---
type: system
updated: 2026-07-19
relations:
  - relation: "routes_to"
    target: "deleted.md"
    reason: "Removed target"
---

Body
`;
  const updated = replaceRelationsBlock(markdown, [], "2026-07-21T01:00:00.000Z");
  assert.deepEqual(getFrontmatterRelations(parseOkfMarkdown(updated).frontmatter), []);
  assert.doesNotMatch(updated, /^relations:/m);
  assert.match(updated, /\nBody\n$/);
});

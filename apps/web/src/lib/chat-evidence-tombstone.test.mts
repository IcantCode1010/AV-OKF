import assert from "node:assert/strict";
import test from "node:test";

import { chatMessageReferencesKnowledgeBundle } from "./chat-evidence-tombstone.ts";

test("matches citations explicitly attributed to the deleted bundle", () => {
  assert.equal(
    chatMessageReferencesKnowledgeBundle({
      bundleId: "kb_deleted",
      citations: [{ knowledgeBundleId: "kb_deleted", sourceType: "okf" }],
      knowledgeBundleIds: ["kb_deleted", "kb_surviving"],
    }),
    true,
  );
});

test("does not tombstone a mixed-scope answer supported only by a surviving bundle", () => {
  assert.equal(
    chatMessageReferencesKnowledgeBundle({
      bundleId: "kb_deleted",
      citations: [{ knowledgeBundleId: "kb_surviving", sourceType: "okf" }],
      knowledgeBundleIds: ["kb_deleted", "kb_surviving"],
    }),
    false,
  );
});

test("uses a single-bundle scope only for legacy citations without bundle identity", () => {
  const legacyCitation = [{ documentTitle: "Legacy concept", sourceType: "okf" }];
  assert.equal(
    chatMessageReferencesKnowledgeBundle({
      bundleId: "kb_deleted",
      citations: legacyCitation,
      knowledgeBundleIds: ["kb_deleted"],
    }),
    true,
  );
  assert.equal(
    chatMessageReferencesKnowledgeBundle({
      bundleId: "kb_deleted",
      citations: legacyCitation,
      knowledgeBundleIds: ["kb_deleted", "kb_surviving"],
    }),
    false,
  );
});

test("never tombstones uncited assistant messages from scope alone", () => {
  assert.equal(
    chatMessageReferencesKnowledgeBundle({
      bundleId: "kb_deleted",
      citations: [],
      knowledgeBundleIds: ["kb_deleted"],
    }),
    false,
  );
});

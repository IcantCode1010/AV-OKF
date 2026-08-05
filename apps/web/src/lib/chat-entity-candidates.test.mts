import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEntityTopicId,
  readEntityCandidates,
} from "./chat-entity-candidates.ts";

test("entity topic identity is stable per bundle and normalized name", () => {
  assert.equal(
    buildEntityTopicId("bundle_1", "  Acme Standard "),
    buildEntityTopicId("bundle_1", "acme standard"),
  );
  assert.notEqual(
    buildEntityTopicId("bundle_1", "Acme Standard"),
    buildEntityTopicId("bundle_2", "Acme Standard"),
  );
});

test("persisted entity candidates fail closed when trace data is malformed", () => {
  assert.deepEqual(readEntityCandidates(null), []);
  assert.deepEqual(readEntityCandidates({ entityCandidates: [{ id: "bad" }] }), []);
  assert.equal(readEntityCandidates({
    entityCandidates: [{
      citationIndex: 1,
      entityType: "standard",
      evidenceQuote: "Acme Standard",
      id: "candidate_1",
      name: "Acme Standard",
      summary: "A source-backed standard identified during chat.",
    }],
  }).length, 1);
});

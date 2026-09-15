import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveRetrievalTriggerCandidates,
  normalizeRetrievalTriggerTerms,
  retrievalTriggerProposalFingerprint,
} from "./retrieval-trigger-proposals.ts";

test("near-miss diagnostics produce bounded aliases absent from concept metadata", () => {
  const candidates = deriveRetrievalTriggerCandidates({
    knowledgeBundleId: "bundle_1",
    nearMissCandidates: [{
      answerableMetadata: { tags: ["braking"] },
      contentHash: "hash_1",
      filePath: "concepts/system/brake-control.md",
      matchReason: "Semantic near miss",
      title: "Brake Control System",
    }],
    queryTerms: ["braking", "deceleration", "stopping"],
  });
  assert.deepEqual(candidates[0]?.suggestedTerms, ["deceleration", "stopping"]);
  assert.equal(candidates[0]?.contentHash, "hash_1");
});

test("missing hashes and already-known terms cannot create proposals", () => {
  assert.deepEqual(deriveRetrievalTriggerCandidates({
    knowledgeBundleId: "bundle_1",
    nearMissCandidates: [{
      answerableMetadata: {},
      filePath: "concept.md",
      matchReason: "weak",
      title: "Hydraulic Pump",
    }],
    queryTerms: ["hydraulic", "pump"],
  }), []);
});

test("trigger normalization is deterministic and bounded", () => {
  assert.deepEqual(
    normalizeRetrievalTriggerTerms(["  Brake-Pressure ", "brake pressure", "ATA 32"]),
    ["ata 32", "brake pressure"],
  );
  assert.equal(
    retrievalTriggerProposalFingerprint({
      contentHash: "hash",
      filePath: "concept.md",
      knowledgeBundleId: "bundle",
      terms: ["Zulu", "alpha"],
    }),
    retrievalTriggerProposalFingerprint({
      contentHash: "hash",
      filePath: "concept.md",
      knowledgeBundleId: "bundle",
      terms: ["alpha", "zulu"],
    }),
  );
});

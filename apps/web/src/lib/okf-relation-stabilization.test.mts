import assert from "node:assert/strict";
import test from "node:test";

import {
  applyPublishedRelationReview,
  isWeakPublishedRelationRationale,
  parseRelationStabilizationOptions,
  RELATION_STABILIZATION_CONFIRMATION,
  resolvePublishedRelationSnapshot,
  topicContainsPublishedRelation,
} from "./okf-relation-stabilization.ts";

test("weak published rationale uses the verifier rationale rather than combined reason", () => {
  assert.equal(isWeakPublishedRelationRationale(null), true);
  assert.equal(isWeakPublishedRelationRationale("Direct reference."), true);
  assert.equal(isWeakPublishedRelationRationale("The source concept explicitly identifies the target procedure by its full operational name."), false);
});

test("published review changes only the selected edge", () => {
  const relations = [
    { relation: "references", target: "concepts/target.md", reason: "Old reason" },
    { relation: "supports", target: "concepts/other.md", reason: "Unchanged" },
  ];
  const reapproved = applyPublishedRelationReview({
    confidence: 0.91,
    decision: "reapprove",
    nextReason: "The source explicitly identifies the target and explains the reference.",
    publishedRelation: "references",
    publishedTargetFile: "concepts/target.md",
    relations,
  });
  assert.equal(reapproved[0]?.reason, "The source explicitly identifies the target and explains the reference.");
  assert.equal(reapproved[1]?.reason, "Unchanged");
  const rejected = applyPublishedRelationReview({
    confidence: null,
    decision: "reject",
    nextReason: "Unused",
    publishedRelation: "references",
    publishedTargetFile: "concepts/target.md",
    relations,
  });
  assert.deepEqual(rejected.map((relation) => relation.target), ["concepts/other.md"]);
});

test("published snapshots preserve the final approved direction", () => {
  assert.deepEqual(resolvePublishedRelationSnapshot({
    reason: "Published reason",
    relation: "references",
    sourceFile: "concepts/a.md",
    targetFile: "concepts/b.md",
    verificationDirection: "reverse",
    verificationRelation: "supports",
  }), {
    direction: "reverse",
    publishedRelation: "supports",
    publishedReason: "Published reason",
    publishedSourceFile: "concepts/b.md",
    publishedTargetFile: "concepts/a.md",
  });
});

test("published relation matching is exact and cleanup apply requires confirmation", () => {
  assert.equal(topicContainsPublishedRelation([
    { relation: "references", target: "concepts/target.md", reason: "Existing" },
  ], { publishedRelation: "references", publishedTargetFile: "concepts/target.md" }), true);
  assert.equal(parseRelationStabilizationOptions([]).apply, false);
  assert.throws(() => parseRelationStabilizationOptions(["--apply"]), /confirmation_required/);
  assert.equal(parseRelationStabilizationOptions(["--apply", "--confirm", RELATION_STABILIZATION_CONFIRMATION]).apply, true);
});

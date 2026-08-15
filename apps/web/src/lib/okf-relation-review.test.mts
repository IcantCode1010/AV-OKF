import assert from "node:assert/strict";
import test from "node:test";

import type { OkfExplorerFile } from "./okf-explorer.ts";
import {
  buildOkfRelationReviewItems,
  formatRelationLabel,
  humanizeRelationFailure,
} from "./okf-relation-review.ts";

function file(overrides: Partial<OkfExplorerFile>): OkfExplorerFile {
  return {
    body: "Body",
    description: "Description",
    descriptionRepeatedExactly: false,
    filename: "concepts/procedure/source.md",
    isParseable: true,
    isReserved: false,
    lifecycleStatus: "active",
    reviewStatus: "human",
    sourceFile: "Operations Manual",
    sourcePages: [10],
    title: "Source procedure",
    trustStatus: "agent_ready",
    type: "procedure",
    ...overrides,
  };
}

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    automaticApprovalError: null,
    automaticApprovalRequested: false,
    id: "candidate-1",
    reason: "shared tags: smoke, response",
    relation: "references",
    signals: ["shared_tags:smoke,response", "preflight_warning:reverse_reference"],
    sourceFile: "concepts/procedure/source.md",
    status: "pending",
    targetFile: "concepts/system/target.md",
    verificationConfidence: 0.94,
    verificationDirection: "proposed",
    verificationError: null,
    verificationEvidenceQuote: "The source procedure applies to the target system.",
    verificationModel: "model-1",
    verificationProvider: "openai",
    verificationRationale: "The evidence explicitly states the relationship.",
    verificationRelation: "applies_to",
    verificationStatus: "confirmed",
    ...overrides,
  };
}

test("relation review projection uses active concept titles and human-readable relation labels", () => {
  const [item] = buildOkfRelationReviewItems({
    candidates: [candidate()] as never,
    files: [
      file({}),
      file({
        filename: "concepts/system/target.md",
        sourceFile: "Systems Guide",
        title: "Target system",
        type: "system",
      }),
    ],
  });

  assert.equal(item.source.title, "Source procedure");
  assert.equal(item.target.title, "Target system");
  assert.equal(item.relationLabel, "Applies To");
  assert.equal(item.sentence, "Source procedure applies to Target system.");
  assert.equal(item.reviewable, true);
  assert.deepEqual(item.warnings, ["reverse reference"]);
  assert.match(item.relationDefinition, /explicitly applies/i);
});

test("reverse verification changes the displayed source and quote authority", () => {
  const [item] = buildOkfRelationReviewItems({
    candidates: [candidate({ verificationDirection: "reverse" })] as never,
    files: [
      file({}),
      file({ filename: "concepts/system/target.md", title: "Target system" }),
    ],
  });

  assert.equal(item.source.title, "Target system");
  assert.equal(item.target.title, "Source procedure");
  assert.equal(item.direction, "reverse");
});

test("inactive or missing concepts remain visible but cannot be approved", () => {
  const [item] = buildOkfRelationReviewItems({
    candidates: [candidate()] as never,
    files: [file({})],
  });

  assert.equal(item.target.available, false);
  assert.equal(item.reviewable, false);
  assert.equal(item.target.title, "Target");
});

test("relation labels and common failures are concise", () => {
  assert.equal(formatRelationLabel("depends_on"), "Depends On");
  assert.equal(humanizeRelationFailure({ automaticApprovalError: null, rationale: null, verificationError: "verification_evidence_quote_missing" }), "No exact source evidence supported this relationship.");
});

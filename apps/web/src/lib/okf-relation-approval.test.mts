import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTOMATIC_RELATION_MIN_CONFIDENCE,
  getAutomaticRelationApprovalBlocker,
} from "./okf-relation-approval.ts";

const confirmedCandidate = {
  automaticApprovalRequested: true,
  verificationConfidence: AUTOMATIC_RELATION_MIN_CONFIDENCE,
  verificationDirection: "proposed",
  verificationEvidenceQuote: "The source explicitly references the target.",
  verificationRationale: "Direct evidence.",
  verificationRelation: "references",
  verificationStatus: "confirmed",
};

test("automatic relation approval requires an explicit request and confirmed verifier output", () => {
  assert.equal(getAutomaticRelationApprovalBlocker(confirmedCandidate), "automatic_relation_publishing_suspended");
  assert.equal(getAutomaticRelationApprovalBlocker(confirmedCandidate, { publishingEnabled: true }), null);
  assert.equal(getAutomaticRelationApprovalBlocker({
    ...confirmedCandidate,
    automaticApprovalRequested: false,
  }, { publishingEnabled: true }), "automatic_relation_not_requested");
  assert.equal(getAutomaticRelationApprovalBlocker({
    ...confirmedCandidate,
    verificationStatus: "running",
  }, { publishingEnabled: true }), "automatic_relation_not_confirmed");
});

test("automatic relation approval rejects confidence below the publication threshold and incomplete evidence", () => {
  assert.equal(getAutomaticRelationApprovalBlocker({
    ...confirmedCandidate,
    verificationConfidence: AUTOMATIC_RELATION_MIN_CONFIDENCE - 0.001,
  }, { publishingEnabled: true }), "automatic_relation_confidence_below_threshold");
  assert.equal(getAutomaticRelationApprovalBlocker({
    ...confirmedCandidate,
    verificationEvidenceQuote: null,
  }, { publishingEnabled: true }), "relation_verification_required");
});

test("automatic relation approval is limited to low-risk structural relations", () => {
  assert.equal(getAutomaticRelationApprovalBlocker({
    ...confirmedCandidate,
    verificationRelation: "part_of",
  }, { publishingEnabled: true }), null);
  assert.equal(getAutomaticRelationApprovalBlocker({
    ...confirmedCandidate,
    verificationRelation: "depends_on",
  }, { publishingEnabled: true }), "automatic_relation_requires_human_review");
});

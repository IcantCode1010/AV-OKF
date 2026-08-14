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
  assert.equal(getAutomaticRelationApprovalBlocker(confirmedCandidate), null);
  assert.equal(getAutomaticRelationApprovalBlocker({
    ...confirmedCandidate,
    automaticApprovalRequested: false,
  }), "automatic_relation_not_requested");
  assert.equal(getAutomaticRelationApprovalBlocker({
    ...confirmedCandidate,
    verificationStatus: "running",
  }), "automatic_relation_not_confirmed");
});

test("automatic relation approval rejects confidence below 90 percent and incomplete evidence", () => {
  assert.equal(getAutomaticRelationApprovalBlocker({
    ...confirmedCandidate,
    verificationConfidence: AUTOMATIC_RELATION_MIN_CONFIDENCE - 0.001,
  }), "automatic_relation_confidence_below_threshold");
  assert.equal(getAutomaticRelationApprovalBlocker({
    ...confirmedCandidate,
    verificationEvidenceQuote: null,
  }), "relation_verification_required");
});

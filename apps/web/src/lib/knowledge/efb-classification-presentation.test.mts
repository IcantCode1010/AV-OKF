import assert from "node:assert/strict";
import { test } from "node:test";
import { presentEfbClassification } from "./efb-classification-presentation.ts";

test("presents processing and ready states without review actions", () => {
  assert.equal(presentEfbClassification("queued").label, "Classifying placement");
  assert.equal(presentEfbClassification("running").actionable, false);
  assert.equal(presentEfbClassification("ready", ["discarded_invalid_evidence"]).label, "Metadata ready");
});

test("maps blocking issues to a precise correction", () => {
  assert.equal(presentEfbClassification("needs_review", ["pilot_qrh_target_id_missing_ambiguous_or_outside_document_scope"]).label, "Choose QRH category");
  assert.equal(presentEfbClassification("needs_review", ["maintenance_ata_chapter_missing_ambiguous_or_outside_document_scope"]).label, "Choose ATA chapter");
  assert.equal(presentEfbClassification("blocked", ["invalid_evidence_quote"]).label, "Fix source evidence");
  assert.equal(presentEfbClassification("needs_review", ["document_applicability_needs_review"]).label, "Fix document applicability");
});

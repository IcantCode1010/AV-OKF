import assert from "node:assert/strict";
import test from "node:test";

import {
  buildInheritedAviationOkfMetadata,
  normalizeAviationDocumentMetadata,
  replaceInheritedAviationOkfMetadata,
} from "./aviation-document-metadata.ts";

test("aviation metadata normalizes aircraft ids, both audiences, and ATA", () => {
  const metadata = normalizeAviationDocumentMetadata({
    aircraftFamily: " Boeing 737NG ",
    aircraftTypeIds: "b738, B739, b738",
    ata: "24-00-00",
    contentPurpose: "technical-reference",
    intendedAudiences: ["both"],
    manualType: "Training Manual",
    sourceClassification: "training-reference",
  });

  assert.deepEqual(metadata.aircraftTypeIds, ["B738", "B739"]);
  assert.deepEqual(metadata.intendedAudiences, ["pilot", "maintenance"]);
  assert.equal(metadata.classificationCode, "24-00-00");
  assert.equal(metadata.subjectFamily, "Boeing 737NG");
});

test("aviation metadata rejects invalid controlled values", () => {
  const base = {
    contentPurpose: "technical-reference",
    intendedAudiences: ["maintenance"],
    sourceClassification: "training-reference",
  };
  assert.throws(() => normalizeAviationDocumentMetadata({ ...base, ata: "ATA chapter 24" }), /invalid_aviation_ata/);
  assert.throws(() => normalizeAviationDocumentMetadata({ ...base, aircraftTypeIds: "737-800" }), /invalid_aviation_aircraft_type_id/);
  assert.throws(() => normalizeAviationDocumentMetadata({ ...base, intendedAudiences: ["passenger"] }), /invalid_aviation_intended_audience/);
  assert.throws(() => normalizeAviationDocumentMetadata({ ...base, sourceClassification: "private" }), /invalid_aviation_source_classification/);
});

test("aviation metadata requires audience and purpose but defaults classification to unknown", () => {
  assert.throws(() => normalizeAviationDocumentMetadata({ contentPurpose: "technical-reference" }), /aviation_intended_audience_required/);
  assert.throws(() => normalizeAviationDocumentMetadata({ intendedAudiences: ["pilot"] }), /aviation_content_purpose_required/);
  assert.equal(normalizeAviationDocumentMetadata({
    contentPurpose: "unknown",
    intendedAudiences: ["pilot"],
  }).sourceClassification, "unknown");
});

test("document metadata produces protected aviation OKF inheritance", () => {
  const document = {
    aircraftFamilyIds: ["737-ng"],
    aircraftTypeIds: ["B738"],
    applicabilityConfidence: 0.96,
    applicabilityEvidence: ["Applicability: 737-800"],
    applicabilityModel: "gpt-5.6-terra",
    applicabilityScope: "specific-variants",
    applicabilityStatus: "accepted",
    classificationCode: "24",
    contentPurpose: "technical-reference",
    documentType: "Training Manual",
    effectivity: "Boeing 737NG",
    intendedAudiences: ["maintenance"],
    licenseIdentifier: "unknown",
    revision: "2.0",
    sourceAuthority: "Example Publisher",
    sourceClassification: "training-reference",
    sourceType: "aviation",
    subjectFamily: "Boeing 737NG",
  };
  assert.deepEqual(buildInheritedAviationOkfMetadata(document), {
    aircraft_family: "Boeing 737NG",
    aircraft_family_ids: ["737-ng"],
    aircraft_type_ids: ["B738"],
    applicability_confidence: 0.96,
    applicability_evidence: ["Applicability: 737-800"],
    applicability_model: "gpt-5.6-terra",
    applicability_scope: "specific-variants",
    applicability_status: "accepted",
    ata: "24",
    content_purpose: "technical-reference",
    effectivity: "Boeing 737NG",
    intended_audiences: ["maintenance"],
    license_identifier: "unknown",
    manual_type: "Training Manual",
    revision: "2.0",
    source_authority: "Example Publisher",
    source_classification: "training-reference",
  });
  assert.deepEqual(replaceInheritedAviationOkfMetadata({
    aircraft_family: "Model output",
    custom_field: "preserved",
  }, document), {
    ...buildInheritedAviationOkfMetadata(document),
    custom_field: "preserved",
  });
});

test("generic documents do not inherit aviation metadata", () => {
  assert.deepEqual(buildInheritedAviationOkfMetadata({
    classificationCode: "24",
    documentType: "Manual",
    effectivity: null,
    revision: null,
    sourceAuthority: null,
    sourceType: "general",
    subjectFamily: "Boeing 737NG",
  }), {});
});

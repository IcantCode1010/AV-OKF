import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAircraftApplicabilitySource,
  normalizeAircraftApplicability,
  normalizeManualAircraftApplicability,
} from "./aircraft-applicability.ts";

test("accepts an exact-evidence entire-family classification", () => {
  const source = "Applicability includes 737-600, 737-700, 737-800 and 737-900 aircraft.";
  const result = normalizeAircraftApplicability({
    aircraftFamilyIds: ["737-ng"],
    aircraftTypeIds: [],
    confidence: 0.96,
    evidence: [source],
    scope: "entire-family",
  }, source);
  assert.equal(result.status, "accepted");
  assert.deepEqual(result.issues, []);
});

test("rejects 737-ng as an aircraft type and ambiguous guesses", () => {
  const result = normalizeAircraftApplicability({
    aircraftFamilyIds: ["737-ng"],
    aircraftTypeIds: ["737-ng"],
    confidence: 0.99,
    evidence: ["Boeing 737"],
    scope: "ambiguous",
  }, "Boeing 737");
  assert.equal(result.status, "needs_review");
  assert.ok(result.issues.includes("family_id_used_as_aircraft_type"));
  assert.ok(result.issues.includes("ambiguous_scope_must_not_guess"));
});

test("requires exact textual evidence for automatic acceptance", () => {
  const result = normalizeAircraftApplicability({
    aircraftFamilyIds: ["737-ng"], aircraftTypeIds: ["B738"], confidence: 0.95,
    evidence: ["This applies only to the 737-800."], scope: "specific-variants",
  }, "Applicability: 737-800");
  assert.equal(result.status, "needs_review");
  assert.ok(result.issues.includes("applicability_evidence_not_exact"));
});

test("manual overrides enforce family and variant scope shapes", () => {
  assert.deepEqual(normalizeManualAircraftApplicability({
    aircraftFamilyIds: "737-ng",
    aircraftTypeIds: "B738, b739",
    scope: "specific-variants",
  }), {
    aircraftFamilyIds: ["737-ng"],
    aircraftTypeIds: ["B738", "B739"],
    scope: "specific-variants",
  });
  assert.throws(() => normalizeManualAircraftApplicability({
    aircraftFamilyIds: "737-ng",
    aircraftTypeIds: "737-ng",
    scope: "specific-variants",
  }), /invalid_specific_variant_applicability/);
});

test("representative source is bounded for large documents", () => {
  const source = buildAircraftApplicabilitySource({
    aircraftTypeIds: [], classificationCode: null, description: "", documentType: null,
    effectivity: null, subjectFamily: null, title: "Manual",
    extractedPages: Array.from({ length: 500 }, (_, index) => ({
      pageNumber: index + 1,
      text: `SECTION ${index + 1}\n${"body ".repeat(3_000)}`,
    })),
  });
  assert.ok(source.length <= 80_000);
  assert.match(source, /Page 500/);
});

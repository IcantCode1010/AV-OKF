import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classificationVocabulary,
  evaluateClassification,
  type Prediction,
} from "./efb-classification-policy.ts";
const registry = {
  schemaVersion: "1.0" as const,
  aircraftFamilies: [{ id: "737-ng", aircraftTypeIds: ["b738"] }],
  placements: {
    ataChapterIds: ["24", "29"],
    qrhTargetIds: ["hydraulics"],
    quickAccessTargetIds: [],
  },
};
const evidence = [
  {
    id: "e",
    documentId: "d",
    page: 1,
    quote:
      "737-800 ATA 29 hydraulic system description for pilots and maintenance personnel.",
  },
];
const prediction: Prediction = {
  audiences: ["pilot", "maintenance"],
  ataChapter: "29",
  qrhTargetId: "hydraulics",
  rationale: "System description",
  ambiguous: false,
  evidence: ["audience", "ata", "qrh"].map((field) => ({
    field: field as "audience" | "ata" | "qrh",
    id: "e",
    quote: evidence[0].quote,
  })),
};
test("dual-audience classification requires grounded placements for both", () => {
  assert.equal(
    evaluateClassification(registry, evidence, [], prediction).status,
    "ready",
  );
  assert.notEqual(
    evaluateClassification(registry, evidence, [], {
      ...prediction,
      qrhTargetId: null,
    }).status,
    "ready",
  );
});
test("registered ATA 28 is labeled Fuel without changing ATA 73", () => {
  const vocabulary = classificationVocabulary({
    ...registry,
    placements: { ...registry.placements, ataChapterIds: ["28", "73"] },
  });
  assert.deepEqual(vocabulary.ata, [
    { id: "28", label: "Fuel" },
    { id: "73", label: "Engine fuel and control" },
  ]);
});
test("invented quote blocks readiness", () => {
  assert.equal(
    evaluateClassification(registry, evidence, [], {
      ...prediction,
      evidence: [{ field: "audience", id: "e", quote: "fabricated evidence" }],
    }).status,
    "blocked",
  );
});
test("model cannot override explicit ATA evidence", () => {
  const r = evaluateClassification(registry, evidence, [], {
    ...prediction,
    ataChapter: "24",
  });
  assert.equal(r.metadata.ataChapter, "29");
  assert.equal(r.status, "needs_review");
});
test("unsupported QRH IDs and declared uncertainty cannot be ready", () => {
  assert.notEqual(
    evaluateClassification(registry, evidence, [], {
      ...prediction,
      qrhTargetId: "invented",
    }).status,
    "ready",
  );
  assert.equal(
    evaluateClassification(registry, evidence, [], {
      ...prediction,
      ambiguous: true,
    }).status,
    "needs_review",
  );
});

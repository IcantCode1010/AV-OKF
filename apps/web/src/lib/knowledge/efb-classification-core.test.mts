import { test } from "node:test";
import assert from "node:assert/strict";
import { deterministicClassification } from "./efb-classification-core.ts";
import { registryFingerprint } from "../project-efb-contract-registry.ts";
const registry = {
  schemaVersion: "1.0" as const,
  aircraftFamilies: [
    { id: "737-ng", aircraftTypeIds: ["b738"] },
    { id: "737-max", aircraftTypeIds: [] },
    { id: "a320", aircraftTypeIds: ["a320-251n"] },
  ],
  placements: {
    ataChapterIds: ["24", "29"],
    qrhTargetIds: ["electrical", "hydraulics"],
    quickAccessTargetIds: [],
  },
};
const evidence = (quote: string) => [
  { id: "e1", documentId: "d1", page: 1, quote },
];
test("family evidence does not imply a specific type", () => {
  const result = deterministicClassification(
    registry,
    evidence("737 NG hydraulic system ATA 29"),
    [],
  );
  assert.deepEqual(result.aircraftFamilyIds, ["737-ng"]);
  assert.deepEqual(result.aircraftTypeIds, []);
  assert.deepEqual(result.ataChapters, ["29"]);
});
test("NG variant evidence resolves the group without narrowing to a type", () => {
  const result = deterministicClassification(
    registry,
    evidence("Boeing 737-800 ATA 24-00"),
    [],
  );
  assert.deepEqual(result.aircraftFamilyIds, ["737-ng"]);
  assert.deepEqual(result.aircraftTypeIds, []);
  assert.deepEqual(result.issues, []);
});
test("MAX evidence remains distinct from NG", () => {
  const result = deterministicClassification(registry, evidence("737 MAX 8 flight controls ATA 29"), []);
  assert.deepEqual(result.aircraftFamilyIds, ["737-max"]);
  assert.deepEqual(result.aircraftTypeIds, []);
  assert(!result.issues.includes("conflicting_aircraft_families"));
});
test("bare 737 is not guessed as NG or MAX", () => {
  const result = deterministicClassification(registry, evidence("Boeing 737 hydraulic system ATA 29"), []);
  assert.deepEqual(result.aircraftFamilyIds, []);
  assert(result.issues.includes("aircraft_evidence_missing"));
});
test("accepted document applicability overrides aircraft mentions in topic evidence", () => {
  const result = deterministicClassification(
    registry,
    evidence("A comparison paragraph mentions an A320-251N in ATA 24."),
    [
      {
        aircraftFamilyIds: ["737-ng"],
        aircraftTypeIds: [],
        applicabilityStatus: "accepted",
      },
    ],
  );
  assert.deepEqual(result.aircraftFamilyIds, ["737-ng"]);
  assert.deepEqual(result.aircraftTypeIds, []);
  assert(!result.issues.includes("conflicting_aircraft_families"));
});
test("competing aircraft and chapters need review", () => {
  const result = deterministicClassification(
    registry,
    evidence("737-800 versus A320-251N. ATA 29 and ATA 24"),
    [],
  );
  assert(result.issues.includes("conflicting_aircraft_families"));
  assert(result.issues.includes("multiple_ata_chapters"));
});
test("unknown manual applicability and unsupported chapters cannot become ready", () => {
  const result = deterministicClassification(registry, evidence("ATA 99"), [
    {
      aircraftFamilyIds: ["unknown"],
      aircraftTypeIds: [],
      applicabilityStatus: "manual_override",
    },
  ]);
  assert(result.issues.includes("unsupported_aircraft_family"));
  assert(result.issues.includes("unsupported_ata"));
});
test("registry hash ignores ordering but detects vocabulary changes", () => {
  assert.equal(
    registryFingerprint(registry),
    registryFingerprint({
      ...registry,
      aircraftFamilies: [...registry.aircraftFamilies].reverse(),
    }),
  );
  assert.notEqual(
    registryFingerprint(registry),
    registryFingerprint({
      ...registry,
      placements: { ...registry.placements, ataChapterIds: ["24"] },
    }),
  );
});

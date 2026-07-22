import assert from "node:assert/strict";
import test from "node:test";

import {
  preflightOkfRelationCandidate,
  resolveRelationDirectionReview,
} from "./okf-relation-preflight.ts";

const activeFiles = [
  { filePath: "concepts/a.md", type: "system" },
  { filePath: "concepts/b.md", type: "system" },
  { filePath: "concepts/c.md", type: "procedure" },
  { filePath: "concepts/d.md", type: "system" },
];
const allowedRelations = ["conflicts_with", "depends_on", "references", "routes_to", "supersedes", "supports"];

function preflight(
  candidate: { relation: string; sourceFile: string; targetFile: string; targetType?: string | null; reason?: string },
  existingEdges: Array<{ relation: string; sourceFile: string; targetFile: string }> = [],
) {
  return preflightOkfRelationCandidate({ activeFiles, allowedRelations, candidate, existingEdges });
}

test("preflight blocks exact and symmetric reverse duplicates", () => {
  const exact = preflight(
    { relation: "supports", sourceFile: "concepts/a.md", targetFile: "concepts/b.md" },
    [{ relation: "supports", sourceFile: "concepts/a.md", targetFile: "concepts/b.md" }],
  );
  assert.equal(exact.accepted, false);
  assert.equal(exact.issues.some((issue) => issue.code === "relation_exact_duplicate"), true);

  const symmetric = preflight(
    { relation: "conflicts_with", sourceFile: "concepts/a.md", targetFile: "concepts/b.md" },
    [{ relation: "conflicts_with", sourceFile: "concepts/b.md", targetFile: "concepts/a.md" }],
  );
  assert.equal(symmetric.accepted, false);
  assert.equal(symmetric.issues.some((issue) => issue.code === "relation_reverse_duplicate"), true);
});

test("preflight allows justified reverse support and reference edges with warnings", () => {
  for (const relation of ["supports", "references"]) {
    const result = preflight(
      { relation, sourceFile: "concepts/a.md", targetFile: "concepts/b.md" },
      [{ relation, sourceFile: "concepts/b.md", targetFile: "concepts/a.md" }],
    );
    assert.equal(result.accepted, true);
    assert.deepEqual(result.issues.map((issue) => [issue.code, issue.severity]), [
      ["relation_reverse_direction_warning", "warning"],
    ]);
  }
});

test("preflight blocks unsafe, missing, inactive, and type-mismatched targets", () => {
  const unsafe = preflight({ relation: "supports", sourceFile: "concepts/a.md", targetFile: "../escape.md" });
  assert.equal(unsafe.accepted, false);
  assert.equal(unsafe.issues.some((issue) => issue.code === "relation_target_invalid"), true);

  const missing = preflight({ relation: "supports", sourceFile: "concepts/a.md", targetFile: "concepts/missing.md" });
  assert.equal(missing.accepted, false);
  assert.equal(missing.issues.some((issue) => issue.code === "relation_target_missing"), true);

  const mismatch = preflight({ relation: "supports", sourceFile: "concepts/a.md", targetFile: "concepts/c.md", targetType: "system" });
  assert.equal(mismatch.accepted, false);
  assert.equal(mismatch.issues.some((issue) => issue.code === "relation_target_type_mismatch"), true);
});

test("preflight blocks cycles and competing supersession", () => {
  for (const relation of ["depends_on", "routes_to", "supersedes"]) {
    const result = preflight(
      { relation, sourceFile: "concepts/c.md", targetFile: "concepts/a.md" },
      [
        { relation, sourceFile: "concepts/a.md", targetFile: "concepts/b.md" },
        { relation, sourceFile: "concepts/b.md", targetFile: "concepts/c.md" },
      ],
    );
    assert.equal(result.accepted, false);
    assert.equal(result.issues.some((issue) => issue.code === "relation_cycle_detected"), true);
  }

  const competing = preflight(
    { relation: "supersedes", sourceFile: "concepts/d.md", targetFile: "concepts/b.md" },
    [{ relation: "supersedes", sourceFile: "concepts/a.md", targetFile: "concepts/b.md" }],
  );
  assert.equal(competing.accepted, false);
  assert.equal(competing.issues.some((issue) => issue.code === "relation_competing_supersedes"), true);
});

test("preflight keeps allowed vocabulary and reason checks centralized", () => {
  const invalid = preflight({ relation: "invented", reason: " ", sourceFile: "concepts/a.md", targetFile: "concepts/b.md" });
  assert.equal(invalid.accepted, false);
  assert.deepEqual(
    invalid.issues.map((issue) => issue.code).sort(),
    ["relation_reason_required", "relation_type_not_allowed"],
  );
});

test("direction review distinguishes a new swap, rejected-row reuse, and a real conflict", () => {
  assert.equal(resolveRelationDirectionReview({ currentCandidateId: "current", selectedCandidate: null }), "update_current");
  assert.equal(resolveRelationDirectionReview({ currentCandidateId: "current", selectedCandidate: { id: "current", status: "pending" } }), "update_current");
  assert.equal(resolveRelationDirectionReview({ currentCandidateId: "current", selectedCandidate: { id: "reverse", status: "rejected" } }), "reuse_rejected");
  assert.equal(resolveRelationDirectionReview({ currentCandidateId: "current", selectedCandidate: { id: "reverse", status: "pending" } }), "conflict");
  assert.equal(resolveRelationDirectionReview({ currentCandidateId: "current", selectedCandidate: { id: "reverse", status: "approved" } }), "conflict");
});

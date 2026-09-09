import assert from "node:assert/strict";
import test from "node:test";
import { recipeSnapshotsEqual } from "./topic-builder-core.ts";

test("database key reordering does not change a recipe", () => {
  const recipe = { topic: "Hydraulics", documentIds: ["a", "b"], maxWords: 180,
    researchPolicy: "v6", id: undefined };
  const stored = { researchPolicy: "v6", maxWords: 180, documentIds: ["a", "b"], topic: "Hydraulics" };
  assert.equal(recipeSnapshotsEqual(recipe, stored), true);
  for (const change of [{ topic: "Electrical" }, { maxWords: 200 },
    { documentIds: ["a"] }, { researchPolicy: "v7" }]) {
    assert.equal(recipeSnapshotsEqual(recipe, { ...stored, ...change }), false);
  }
});

test("database-owned recipe fields do not invalidate an immutable run", () => {
  const captured = {
    topic: "Flaps disagree",
    audience: "pilot",
    applicability: "737 NG",
    instructions: "",
    maxWords: 180,
    researchMode: "agentic",
    collectionIds: [],
    documentIds: ["manual-a", "manual-b"],
    writingPolicy: "instructor-v2",
    researchPolicy: "graph-research-v6",
    workspaceId: "workspace-at-creation",
    createdBy: "author-at-creation",
  };
  const loaded = {
    ...captured,
    id: "recipe-id",
    workspaceId: "workspace-loaded-by-prisma",
    createdBy: "author-loaded-by-prisma",
    createdAt: new Date("2026-09-06T15:53:09Z"),
    updatedAt: new Date("2026-09-06T15:53:10Z"),
    approvedRunId: null,
  };

  assert.equal(recipeSnapshotsEqual(captured, loaded), true);
  assert.equal(recipeSnapshotsEqual(captured, { ...loaded, researchMode: "exhaustive" }), false);
  assert.equal(recipeSnapshotsEqual(captured, { ...loaded, researchPolicy: "graph-research-v7" }), false);
});

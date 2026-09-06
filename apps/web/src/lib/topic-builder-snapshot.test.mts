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

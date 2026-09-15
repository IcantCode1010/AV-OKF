import assert from "node:assert/strict";
import test from "node:test";
import { builderSourcesMatchBundle } from "./topic-builder-scope.ts";

test("builder accepts only the active bundle's documents and collection", () => {
  assert.equal(builderSourcesMatchBundle("737", [], ["flight-controls"], ["flight-controls"]), true);
  assert.equal(builderSourcesMatchBundle("737", ["737"], [], []), true);
  assert.equal(builderSourcesMatchBundle("737", ["737"], ["flight-controls"], ["flight-controls"]), true);
  assert.equal(builderSourcesMatchBundle("737", [], ["airbus"], ["flight-controls"]), false);
  assert.equal(builderSourcesMatchBundle("737", ["airbus"], [], ["flight-controls"]), false);
  assert.equal(builderSourcesMatchBundle("737", ["737", "airbus"], [], []), false);
  assert.equal(builderSourcesMatchBundle("737", [], ["unassigned"], []), false);
  assert.equal(builderSourcesMatchBundle("737", [], [], []), false);
});

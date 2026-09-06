import assert from "node:assert/strict";
import test from "node:test";
import { matchesEfbAircraftFamily } from "./efb-aircraft-catalog.ts";

test("EFB selection accepts supported application keys within their family", () => {
  assert.equal(matchesEfbAircraftFamily("737-ng", ["b738"]), true);
  assert.equal(matchesEfbAircraftFamily("Boeing 737NG", ["b738"]), true);
  assert.equal(matchesEfbAircraftFamily("a320-family", ["a320"]), true);
  for (const [family, types] of [["737-ng", []], ["737-ng", ["a320"]], ["a320-family", ["a20n"]], ["737-ng", ["b738", "b739"]], ["unknown", ["b738"]]] as const) {
    assert.equal(matchesEfbAircraftFamily(family, types), false);
  }
});

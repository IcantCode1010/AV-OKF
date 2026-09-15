import assert from "node:assert/strict";
import test from "node:test";
import { matchesEfbAircraftFamily, normalizeEfbAircraftFamily } from "./efb-aircraft-catalog.ts";

test("EFB selection accepts supported application keys within their family", () => {
  assert.equal(matchesEfbAircraftFamily("737-ng", ["b738"]), true);
  assert.equal(matchesEfbAircraftFamily("Boeing 737NG", ["b738"]), true);
  assert.equal(matchesEfbAircraftFamily("a320", ["a320-251n"]), true);
  assert.equal(normalizeEfbAircraftFamily("Airbus A319/A320 family"), "a320");
  assert.equal(matchesEfbAircraftFamily("737-ng", []), true);
  for (const [family, types] of [["737-ng", ["a320-251n"]], ["a320", ["a20n"]], ["737-ng", ["b738", "b739"]], ["unknown", ["b738"]]] as const) {
    assert.equal(matchesEfbAircraftFamily(family, types), false);
  }
});

test("EFB selection recognizes the MAX educational group", () => {
  assert.equal(normalizeEfbAircraftFamily("Boeing 737 MAX"), "737-max");
  assert.equal(matchesEfbAircraftFamily("737-max", []), true);
});

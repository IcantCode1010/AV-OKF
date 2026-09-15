import assert from "node:assert/strict";
import test from "node:test";
import { frameGraphBounds } from "./graph-framing.ts";

test("framing centers offset networks instead of including empty space to the origin", () => {
  const a = frameGraphBounds({ x: [900, 1100], y: [1900, 2100], z: [-10, 10] }, 1200, 800);
  const b = frameGraphBounds({ x: [-100, 100], y: [-100, 100], z: [-10, 10] }, 1200, 800);
  assert.deepEqual(a.center, { x: 1000, y: 2000, z: 0 });
  assert.equal(a.position.z, b.position.z);
});
test("every bounding-box corner fits portrait and landscape viewports", () => {
  for (const [width, height] of [[390, 700], [1800, 800], [768, 900]]) {
    const bounds = { x: [-250, 300], y: [-100, 180], z: [-90, 90] } as const;
    const result = frameGraphBounds({ x: [...bounds.x], y: [...bounds.y], z: [...bounds.z] }, width, height);
    for (const x of bounds.x) for (const y of bounds.y) for (const z of bounds.z) {
      const depth = result.position.z - z;
      assert.ok(Math.abs(x - result.center.x) / (depth * Math.tan(25 * Math.PI / 180) * width / height) < 1);
      assert.ok(Math.abs(y - result.center.y) / (depth * Math.tan(25 * Math.PI / 180)) < 1);
    }
  }
});
test("single-node framing retains a usable camera distance", () => {
  assert.ok(frameGraphBounds({ x: [0, 0], y: [0, 0], z: [0, 0] }, 390, 700).position.z > 0);
});

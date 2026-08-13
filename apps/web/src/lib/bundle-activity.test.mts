import assert from "node:assert/strict";
import test from "node:test";

import { buildBundleActivitySnapshot, normalizeBundleActivityEventStatus } from "./bundle-activity.ts";

test("bundle activity summarizes attention and active work deterministically", () => {
  const items = [
    { id: "complete", occurredAt: "2026-08-01T00:00:00.000Z", stage: "Export", status: "completed", title: "A", detail: "Done" },
    { id: "active", occurredAt: "2026-08-02T00:00:00.000Z", stage: "Discovery", status: "running", title: "B", detail: "Running" },
    { id: "review", occurredAt: "2026-08-03T00:00:00.000Z", stage: "Review", status: "action_required", title: "C", detail: "Review" },
  ] as const;
  const snapshot = buildBundleActivitySnapshot([...items]);
  assert.equal(snapshot.active, true);
  assert.deepEqual(snapshot.items.map((item) => item.id), ["review", "active", "complete"]);
  assert.deepEqual(snapshot.summary, { processing: 1, awaitingReview: 1, failed: 0, completed: 1 });
  assert.equal(snapshot.fingerprint, buildBundleActivitySnapshot([...items].reverse()).fingerprint);
});

test("historical processing events do not keep live activity polling active", () => {
  assert.equal(normalizeBundleActivityEventStatus("Processing"), "completed");
  assert.equal(normalizeBundleActivityEventStatus("Review required"), "completed");
  assert.equal(normalizeBundleActivityEventStatus("Extraction failed"), "completed");
});

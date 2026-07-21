import assert from "node:assert/strict";
import test from "node:test";

import { hasBulkRunStatusChanged } from "./bulk-run-poller.tsx";

test("bulk run polling reloads only for a changed status snapshot", () => {
  assert.equal(hasBulkRunStatusChanged("snapshot-a", "snapshot-a"), false);
  assert.equal(hasBulkRunStatusChanged("snapshot-a", "snapshot-b"), true);
});

import assert from "node:assert/strict";
import test from "node:test";

import { hasDocumentDeletionStatusChanged } from "./document-deletion-poller.tsx";

test("document deletion polling refreshes only for a changed status snapshot", () => {
  assert.equal(hasDocumentDeletionStatusChanged("snapshot-a", "snapshot-a"), false);
  assert.equal(hasDocumentDeletionStatusChanged("snapshot-a", "snapshot-b"), true);
});

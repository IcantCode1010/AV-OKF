import assert from "node:assert/strict";
import test from "node:test";

import {
  operationProgressBackoffMs,
  parseOperationProgressSnapshot,
  shouldRefreshOperationProgressTerminal,
} from "./operation-progress.ts";

const validSnapshot = {
  active: true,
  data: { queued: 2 },
  fingerprint: "snapshot-1",
  generatedAt: "2026-08-23T12:00:00.000Z",
  operations: [{
    completed: 1,
    detail: "One topic completed.",
    id: "run-1",
    kind: "topic_expansion",
    label: "Topic expansion",
    stage: "searching_sources",
    status: "running",
    total: 3,
    updatedAt: "2026-08-23T12:00:00.000Z",
  }],
};

test("operation progress accepts a complete structured snapshot", () => {
  assert.deepEqual(parseOperationProgressSnapshot(validSnapshot), validSnapshot);
});

test("operation progress rejects malformed or unsafe responses", () => {
  assert.equal(parseOperationProgressSnapshot({ ...validSnapshot, active: "yes" }), null);
  assert.equal(parseOperationProgressSnapshot({ ...validSnapshot, operations: [{ ...validSnapshot.operations[0], status: "thinking" }] }), null);
  assert.equal(parseOperationProgressSnapshot({ ...validSnapshot, operations: [{ ...validSnapshot.operations[0], action: { href: "https://example.com", label: "Leave" } }] }), null);
});

test("operation progress backoff is bounded", () => {
  assert.equal(operationProgressBackoffMs(1), 4_000);
  assert.equal(operationProgressBackoffMs(2), 8_000);
  assert.equal(operationProgressBackoffMs(4), 30_000);
  assert.equal(operationProgressBackoffMs(99), 30_000);
});

test("terminal refresh occurs once only for active to inactive", () => {
  assert.equal(shouldRefreshOperationProgressTerminal({ alreadyRefreshed: false, nextActive: false, previousActive: true }), true);
  assert.equal(shouldRefreshOperationProgressTerminal({ alreadyRefreshed: true, nextActive: false, previousActive: true }), false);
  assert.equal(shouldRefreshOperationProgressTerminal({ alreadyRefreshed: false, nextActive: true, previousActive: true }), false);
});

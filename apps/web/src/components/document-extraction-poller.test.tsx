import assert from "node:assert/strict";
import test from "node:test";

import { resolveDocumentProcessingPollDecision } from "./document-extraction-poller.tsx";

test("processing polling continues only while an unchanged state is active", () => {
  assert.equal(
    resolveDocumentProcessingPollDecision({
      currentFingerprint: "same",
      next: { active: true, fingerprint: "same" },
      previousTransition: null,
    }),
    "continue",
  );
  assert.equal(
    resolveDocumentProcessingPollDecision({
      currentFingerprint: "same",
      next: { active: false, fingerprint: "same" },
      previousTransition: null,
    }),
    "stop",
  );
});

test("processing polling reloads once for a changed state and then stops", () => {
  assert.equal(
    resolveDocumentProcessingPollDecision({
      currentFingerprint: "old",
      next: { active: false, fingerprint: "new" },
      previousTransition: null,
    }),
    "reload",
  );
  assert.equal(
    resolveDocumentProcessingPollDecision({
      currentFingerprint: "old",
      next: { active: false, fingerprint: "new" },
      previousTransition: "old\u0000new",
    }),
    "stop",
  );
});

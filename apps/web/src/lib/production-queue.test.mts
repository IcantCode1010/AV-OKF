import assert from "node:assert/strict";
import test from "node:test";

import { buildExtractionJobId } from "./production-queue.ts";

test("buildExtractionJobId is deterministic for document and extraction job", () => {
  assert.equal(
    buildExtractionJobId({
      documentId: "doc_123",
      extractionJobId: "job_456",
    }),
    "extract:doc_123:job_456",
  );
});

test("buildExtractionJobId rejects ids that would corrupt queue keys", () => {
  assert.throws(
    () =>
      buildExtractionJobId({
        documentId: "doc:123",
        extractionJobId: "job_456",
      }),
    /unsafe_queue_id_segment/,
  );
});

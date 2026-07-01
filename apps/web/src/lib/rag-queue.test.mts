import assert from "node:assert/strict";
import test from "node:test";

import { buildRagIndexJobId } from "./rag-queue.ts";

test("buildRagIndexJobId is deterministic", () => {
  assert.equal(
    buildRagIndexJobId({ documentId: "doc_1", indexJobId: "job_1" }),
    "rag-index:doc_1:job_1",
  );
});

test("buildRagIndexJobId rejects unsafe segments", () => {
  assert.throws(
    () => buildRagIndexJobId({ documentId: "doc:1", indexJobId: "job_1" }),
    /unsafe_queue_id_segment/,
  );
});

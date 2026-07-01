import assert from "node:assert/strict";
import test from "node:test";

import { buildDocumentObjectKey } from "./production-storage.ts";

test("buildDocumentObjectKey scopes opaque PDFs by workspace and document", () => {
  const key = buildDocumentObjectKey({
    documentId: "doc_123",
    objectId: "018f4f8a-39a0-7f09-912e-85b55f99a999",
    workspaceId: "wrk_abc",
  });

  assert.equal(
    key,
    "workspaces/wrk_abc/documents/doc_123/original/018f4f8a-39a0-7f09-912e-85b55f99a999.pdf",
  );
  assert.equal(key.includes("manual.pdf"), false);
  assert.equal(key.includes(".."), false);
  assert.equal(key.includes("\\"), false);
});

test("buildDocumentObjectKey rejects unsafe ids before storage access", () => {
  assert.throws(
    () =>
      buildDocumentObjectKey({
        documentId: "../doc",
        objectId: "018f4f8a-39a0-7f09-912e-85b55f99a999",
        workspaceId: "wrk_abc",
      }),
    /unsafe_object_key_segment/,
  );
});

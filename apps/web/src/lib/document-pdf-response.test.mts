import assert from "node:assert/strict";
import test from "node:test";

import { createDocumentPdfResponse } from "./document-pdf-response.ts";

const context = { role: "admin" as const, userId: "usr_1", workspaceId: "wrk_1" };

test("valid workspace request streams inline PDF bytes", async () => {
  const bytes = Buffer.from("%PDF-test");
  const response = await createDocumentPdfResponse("doc_1", {
    getBytes: async () => bytes,
    getContext: async () => context,
    getWorkspaceId: async () => "wrk_1",
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.match(response.headers.get("content-disposition") ?? "", /^inline;/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
});

test("cross-workspace document requests fail closed before reading bytes", async () => {
  let byteReads = 0;
  const response = await createDocumentPdfResponse("doc_other", {
    getBytes: async () => {
      byteReads += 1;
      return Buffer.from("%PDF-secret");
    },
    getContext: async () => context,
    getWorkspaceId: async () => "wrk_other",
  });

  assert.equal(response.status, 404);
  assert.equal(byteReads, 0);
});

test("missing document and object records return clean not-found responses", async () => {
  const missingDocument = await createDocumentPdfResponse("doc_missing", {
    getBytes: async () => Buffer.alloc(0),
    getContext: async () => context,
    getWorkspaceId: async () => undefined,
  });
  const missingObject = await createDocumentPdfResponse("doc_1", {
    getBytes: async () => {
      throw new Error("document_has_no_stored_pdf");
    },
    getContext: async () => context,
    getWorkspaceId: async () => "wrk_1",
  });

  assert.equal(missingDocument.status, 404);
  assert.equal(missingObject.status, 404);
  assert.doesNotMatch(await missingObject.text(), /stored_pdf|stack/i);
});

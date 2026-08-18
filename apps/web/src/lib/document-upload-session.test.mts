import assert from "node:assert/strict";
import test from "node:test";

import { MAX_LARGE_PDF_UPLOAD_BYTES, validateDocumentUploadDeclaration } from "./document-upload-session.ts";

const valid = {
  contentType: "application/pdf",
  filename: "large-manual.pdf",
  knowledgeBundleId: "bundle_1",
  metadata: { description: "", owner: "Owner", sourceType: "general" as const, tags: [], title: "Manual" },
  sizeBytes: MAX_LARGE_PDF_UPLOAD_BYTES,
};

test("direct upload declaration accepts the 250 MB boundary", () => {
  assert.doesNotThrow(() => validateDocumentUploadDeclaration(valid));
});

test("direct upload declaration rejects oversize and non-PDF input", () => {
  assert.throws(() => validateDocumentUploadDeclaration({ ...valid, sizeBytes: MAX_LARGE_PDF_UPLOAD_BYTES + 1 }), /upload_exceeds_250mb_limit/);
  assert.throws(() => validateDocumentUploadDeclaration({ ...valid, contentType: "text/plain" }), /only_pdf_uploads_supported/);
  assert.throws(() => validateDocumentUploadDeclaration({ ...valid, filename: "..\\payload.txt" }), /only_pdf_uploads_supported/);
});

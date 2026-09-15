import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveDocumentUploadBatchStatus,
  MAX_DOCUMENTS_PER_UPLOAD_BATCH,
  MAX_LARGE_PDF_UPLOAD_BYTES,
  validateDocumentUploadBatchDeclarations,
  validateDocumentUploadDeclaration,
} from "./document-upload-session.ts";

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

test("aviation upload declarations validate controlled metadata before presigning", () => {
  const aviation = {
    ...valid,
    metadata: {
      ...valid.metadata,
      aircraftTypeIds: ["b738"],
      classificationCode: "24",
      contentPurpose: "technical-reference",
      intendedAudiences: ["maintenance" as const],
      sourceClassification: "training-reference" as const,
      sourceType: "aviation" as const,
    },
  };
  assert.doesNotThrow(() => validateDocumentUploadDeclaration(aviation));
  assert.throws(() => validateDocumentUploadDeclaration({
    ...aviation,
    metadata: { ...aviation.metadata, classificationCode: "chapter 24" },
  }), /invalid_aviation_ata/);
  assert.throws(() => validateDocumentUploadDeclaration({
    ...aviation,
    metadata: { ...aviation.metadata, intendedAudiences: [] },
  }), /aviation_intended_audience_required/);
});

test("upload batches accept one to ten independently validated PDFs", () => {
  const upload = {
    contentType: valid.contentType,
    filename: valid.filename,
    metadata: valid.metadata,
    sizeBytes: valid.sizeBytes,
  };
  assert.doesNotThrow(() => validateDocumentUploadBatchDeclarations([upload]));
  assert.doesNotThrow(() => validateDocumentUploadBatchDeclarations(
    Array.from({ length: MAX_DOCUMENTS_PER_UPLOAD_BATCH }, () => upload),
  ));
  assert.throws(() => validateDocumentUploadBatchDeclarations([]), /invalid_upload_batch_size/);
  assert.throws(
    () => validateDocumentUploadBatchDeclarations(
      Array.from({ length: MAX_DOCUMENTS_PER_UPLOAD_BATCH + 1 }, () => upload),
    ),
    /invalid_upload_batch_size/,
  );
});

test("upload batch status preserves independent partial outcomes", () => {
  assert.equal(deriveDocumentUploadBatchStatus(["initiated", "finalized"]), "in_progress");
  assert.equal(deriveDocumentUploadBatchStatus(["finalized", "finalized"]), "completed");
  assert.equal(deriveDocumentUploadBatchStatus(["finalized", "failed"]), "completed_with_failures");
  assert.equal(deriveDocumentUploadBatchStatus(["cancelled", "cancelled"]), "cancelled");
  assert.equal(deriveDocumentUploadBatchStatus(["failed", "expired"]), "failed");
});

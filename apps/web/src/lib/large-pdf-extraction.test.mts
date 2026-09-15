import assert from "node:assert/strict";
import test from "node:test";

import { classifyExtractedPage, classifyQpdfCheckError } from "./large-pdf-extraction.ts";

test("inspection classification distinguishes digital, scanned, blank, and unreadable pages", () => {
  assert.equal(classifyExtractedPage({ digitalText: "This digital page has enough meaningful source text.", hasRaster: false }).extractionMethod, "digital");
  assert.equal(classifyExtractedPage({ digitalText: "", hasRaster: true, ocrConfidence: 91, ocrText: "A scanned page with readable grounded operating instructions." }).extractionMethod, "ocr");
  assert.equal(classifyExtractedPage({ digitalText: "", hasRaster: false }).extractionMethod, "blank");
  assert.deepEqual(classifyExtractedPage({ digitalText: "", hasRaster: true, ocrConfidence: 8, ocrText: "x" }).warningCodes, ["ocr_unreadable"]);
});

test("qpdf warning exits do not misclassify an explicitly unencrypted PDF", () => {
  assert.equal(classifyQpdfCheckError({
    code: 3,
    message: "File is not encrypted; operation succeeded with warnings",
  }), "recoverable_warnings");
  assert.equal(classifyQpdfCheckError({ code: 2, message: "invalid password" }), "password_protected");
  assert.equal(classifyQpdfCheckError({ code: 2, message: "damaged xref table" }), "malformed");
});

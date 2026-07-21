import assert from "node:assert/strict";
import test from "node:test";

import { getPdfUploadSizeError } from "./pdf-upload-validation.ts";

test("PDF upload size validation accepts a file at the configured limit", () => {
  assert.equal(getPdfUploadSizeError(25 * 1024 * 1024, 25 * 1024 * 1024), null);
});

test("PDF upload size validation reports the selected and maximum sizes", () => {
  assert.equal(
    getPdfUploadSizeError(26.5 * 1024 * 1024, 25 * 1024 * 1024),
    "File is 26.5 MB. Maximum upload size is 25 MB.",
  );
});

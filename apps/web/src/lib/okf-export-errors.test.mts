import assert from "node:assert/strict";
import test from "node:test";

import { formatOkfExportError } from "./okf-export-errors.ts";

test("formatOkfExportError names missing document metadata fields clearly", () => {
  assert.equal(
    formatOkfExportError(
      "okf_export_missing_document_metadata: classificationCode, effectivity, sourceAuthority",
    ),
    "Add missing OKF metadata before export: classification code, effectivity, source authority.",
  );
});

test("formatOkfExportError ignores empty input and falls back for unknown errors", () => {
  assert.equal(formatOkfExportError(undefined), null);
  assert.equal(formatOkfExportError("unexpected_failure"), "OKF export could not start.");
});

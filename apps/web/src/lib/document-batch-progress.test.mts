import assert from "node:assert/strict";
import test from "node:test";

import { summarizeExtractionMethodCounts } from "./document-batch-progress.ts";

test("batch progress reports live OCR and unreadable page counts", () => {
  assert.deepEqual(
    summarizeExtractionMethodCounts([
      { _count: { _all: 120 }, extractionMethod: "digital" },
      { _count: { _all: 19 }, extractionMethod: "ocr" },
      { _count: { _all: 2 }, extractionMethod: "unreadable" },
      { _count: { _all: 4 }, extractionMethod: "blank" },
    ]),
    { ocr: 19, total: 145, unreadable: 2 },
  );
});

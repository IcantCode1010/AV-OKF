import assert from "node:assert/strict";
import test from "node:test";

import { resolveOkfReaderLink } from "./okf-reader-link.ts";

const files = [
  "concepts/inspection.md",
  "references/manual.md",
  "tables/customers.md",
];

test("reader resolves relative and canonical bundle-root links", () => {
  assert.deepEqual(
    resolveOkfReaderLink("concepts/inspection.md", "../references/manual.md#limits", files),
    { filename: "references/manual.md", kind: "internal" },
  );
  assert.deepEqual(
    resolveOkfReaderLink("concepts/inspection.md", "/tables/customers.md", files),
    { filename: "tables/customers.md", kind: "internal" },
  );
});

test("reader rejects missing, escaping, malformed, and non-Markdown links", () => {
  for (const href of [
    "../../outside.md",
    "/tables/missing.md",
    "javascript:alert.md",
    "..%5Creferences%5Cmanual.md",
    "manual.pdf",
    "%E0%A4%A",
  ]) {
    assert.deepEqual(
      resolveOkfReaderLink("concepts/inspection.md", href, files),
      { kind: "broken" },
      href,
    );
  }
});

test("reader preserves external web links", () => {
  assert.deepEqual(
    resolveOkfReaderLink("concepts/inspection.md", "https://example.com/manual", files),
    { kind: "external" },
  );
});

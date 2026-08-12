import assert from "node:assert/strict";
import test from "node:test";

import { resolveDocumentUploadBundleSelection } from "./document-upload-bundle-selection.ts";

const bundles = [{ id: "bundle-a" }, { id: "bundle-b" }];

test("preselects the requested active bundle", () => {
  assert.equal(
    resolveDocumentUploadBundleSelection(bundles, "bundle-b"),
    "bundle-b",
  );
});

test("falls back safely when the requested bundle is unavailable", () => {
  assert.equal(
    resolveDocumentUploadBundleSelection(bundles, "cross-workspace-bundle"),
    "bundle-a",
  );
  assert.equal(resolveDocumentUploadBundleSelection(bundles, undefined), "bundle-a");
  assert.equal(resolveDocumentUploadBundleSelection([], "bundle-a"), undefined);
});

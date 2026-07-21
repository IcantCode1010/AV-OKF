import assert from "node:assert/strict";
import test from "node:test";

import {
  getDocumentDetailHref,
  getDocumentProcessingHref,
  shouldIgnoreDocumentRowNavigation,
} from "./document-row-navigation.ts";

test("getDocumentDetailHref builds document detail route", () => {
  assert.equal(
    getDocumentDetailHref("doc_0c8d735e-3664-4695-b709-9db23a0ad25f"),
    "/documents/doc_0c8d735e-3664-4695-b709-9db23a0ad25f",
  );
});

test("getDocumentProcessingHref builds the post-upload processing route", () => {
  assert.equal(
    getDocumentProcessingHref("doc_0c8d735e-3664-4695-b709-9db23a0ad25f"),
    "/documents/doc_0c8d735e-3664-4695-b709-9db23a0ad25f?panel=processing",
  );
});

test("shouldIgnoreDocumentRowNavigation ignores form controls but not plain row content", () => {
  assert.equal(shouldIgnoreDocumentRowNavigation(fakeTarget(null)), false);
  assert.equal(shouldIgnoreDocumentRowNavigation(fakeTarget("button")), true);
  assert.equal(shouldIgnoreDocumentRowNavigation(fakeTarget("input")), true);
});

test("shouldIgnoreDocumentRowNavigation ignores clicks inside the row's own title link", () => {
  // The title cell already renders a Link to the same href. Letting the
  // row's onClick also fire on that click races two concurrent
  // client-side navigations to the same URL and can silently drop both.
  assert.equal(shouldIgnoreDocumentRowNavigation(fakeTarget("a")), true);
});

function fakeTarget(match: string | null) {
  return {
    closest(selector: string) {
      return match && selector.includes(match) ? {} : null;
    },
  };
}

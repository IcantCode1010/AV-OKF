import assert from "node:assert/strict";
import test from "node:test";

import { resolveBundleWorkspaceHref, sectionForPathname, selectActiveKnowledgeBundle } from "./active-bundle-navigation.ts";

const bundles = [
  { id: "bundle-a", name: "A" },
  { id: "bundle-b", name: "B" },
] as never[];

test("active bundle selection accepts only a bundle in the available workspace list", () => {
  assert.equal(selectActiveKnowledgeBundle(bundles, "bundle-b")?.id, "bundle-b");
  assert.equal(selectActiveKnowledgeBundle(bundles, "foreign")?.id, "bundle-a");
  assert.equal(selectActiveKnowledgeBundle([], "bundle-a"), null);
});

test("bundle workspace destinations are fixed and bundle scoped", () => {
  assert.equal(resolveBundleWorkspaceHref("bundle-a", "graph"), "/knowledge/bundle-a/graph");
  assert.equal(resolveBundleWorkspaceHref("bundle-a", "chat"), "/chat");
  assert.equal(
    resolveBundleWorkspaceHref("bundle/a", "documents"),
    "/documents?scope=bundle&knowledgeBundleId=bundle%2Fa",
  );
});

test("pathname mapping preserves the current workspace section", () => {
  assert.equal(sectionForPathname("/chat/session-1"), "chat");
  assert.equal(sectionForPathname("/documents/doc-1"), "documents");
  assert.equal(sectionForPathname("/knowledge/bundle-a/review/run-1"), "review");
  assert.equal(sectionForPathname("/knowledge/bundle-a/topic"), "browse");
});

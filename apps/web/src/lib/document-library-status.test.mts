import assert from "node:assert/strict";
import test from "node:test";

import { deriveDocumentLibraryStatus } from "./document-library-status.ts";

const completedExtraction = {
  assignedToBundle: true,
  extractionStatus: "completed" as const,
  persistedStatus: "ready" as const,
  ragStatus: "not_indexed",
  unresolvedTopicCount: 0,
};

test("extraction completion does not present an unfinished pipeline as ready", () => {
  assert.equal(deriveDocumentLibraryStatus(completedExtraction), "pending");
  assert.equal(deriveDocumentLibraryStatus({
    ...completedExtraction,
    authoringStatus: "awaiting_cost_confirmation",
  }), "pending");
});

test("active authoring and automatic approval remain processing", () => {
  assert.equal(deriveDocumentLibraryStatus({
    ...completedExtraction,
    authoringStatus: "running",
  }), "processing");
  assert.equal(deriveDocumentLibraryStatus({
    ...completedExtraction,
    authoringStatus: "ready_for_review",
    automaticApprovalStatus: "running",
    unresolvedTopicCount: 3,
  }), "processing");
});

test("manual review and terminal indexing are distinct", () => {
  assert.equal(deriveDocumentLibraryStatus({
    ...completedExtraction,
    authoringStatus: "ready_for_review",
    ragStatus: "indexed",
    unresolvedTopicCount: 3,
  }), "needs_review");
  assert.equal(deriveDocumentLibraryStatus({
    ...completedExtraction,
    authoringStatus: "ready_for_review",
    ragStatus: "indexed",
  }), "indexed");
});

test("failed extraction, authoring, or indexing stays blocked", () => {
  assert.equal(deriveDocumentLibraryStatus({
    ...completedExtraction,
    authoringStatus: "failed",
  }), "blocked");
  assert.equal(deriveDocumentLibraryStatus({
    ...completedExtraction,
    authoringStatus: "running",
    ragStatus: "failed",
  }), "blocked");
});

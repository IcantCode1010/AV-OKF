import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  BulkTopicReviewList,
  reviewCategory,
  type BulkReviewTopic,
} from "./bulk-topic-review-list.tsx";

function topic(overrides: Partial<BulkReviewTopic>): BulkReviewTopic {
  return {
    confidence: "high",
    documentId: "document-1",
    documentTitle: "Operations Manual",
    eligibilityErrors: [],
    eligible: true,
    enrichmentLevel: "complete",
    enrichmentScore: 100,
    enrichedSummary: "A concise topic summary.",
    enrichedTitle: "Ready inspection procedure",
    id: "topic-ready",
    okfType: "procedure",
    overlapWarnings: [],
    pageEnd: 12,
    pageStart: 10,
    proposedSourcePageNumbers: [],
    reviewStatus: "needs_review",
    sourcePageNumbers: [10, 11, 12],
    ...overrides,
  };
}

test("topic review categories distinguish approval states from readiness", () => {
  assert.equal(reviewCategory(topic({ reviewStatus: "approved" })), "approved");
  assert.equal(reviewCategory(topic({ reviewStatus: "rejected" })), "rejected");
  assert.equal(reviewCategory(topic({ eligible: true })), "ready");
  assert.equal(reviewCategory(topic({ eligible: false })), "needs_review");
});

test("review list opens on actionable topics and keeps approved topics in a separate filter", () => {
  const markup = renderToStaticMarkup(
    createElement(BulkTopicReviewList, {
      bundleId: "bundle-1",
      documentId: "document-1",
      topics: [
        topic({}),
        topic({
          enrichedTitle: "Approved emergency procedure",
          id: "topic-approved",
          reviewStatus: "approved",
        }),
        topic({
          eligibilityErrors: ["source_pages_unresolved"],
          eligible: false,
          enrichedTitle: "Topic needing individual review",
          id: "topic-review",
        }),
      ],
    }),
  );

  assert.match(markup, /aria-label="Review status filters"/);
  assert.match(markup, /Needs action.*2/);
  assert.match(markup, /Ready to approve.*1/);
  assert.match(markup, /Approved.*1/);
  assert.match(markup, /Ready inspection procedure/);
  assert.match(markup, /Enrichment completeness 100%/);
  assert.match(markup, /Topic needing individual review/);
  assert.doesNotMatch(markup, /Approved emergency procedure/);
  assert.match(markup, /type="hidden" name="documentId" value="document-1"/);
  assert.match(markup, /Step 1 of 2/);
  assert.match(markup, /Continue to confirmation/);
  assert.match(markup, /Nothing is approved or exported until Step 2/);
});

test("review rows disclose additional source context without presenting it as a blocker", () => {
  const markup = renderToStaticMarkup(
    createElement(BulkTopicReviewList, {
      bundleId: "bundle-1",
      topics: [topic({ proposedSourcePageNumbers: [13, 14] })],
    }),
  );

  assert.match(markup, /additional context from pages 13-14/i);
  assert.match(markup, /Additional context pages will be included/i);
  assert.doesNotMatch(markup, /proposed pages require review/i);
});

test("ready topics disclose shared pages without blocking selection", () => {
  const markup = renderToStaticMarkup(
    createElement(BulkTopicReviewList, {
      bundleId: "bundle-1",
      topics: [topic({ overlapWarnings: ["Shares page 134 with Cargo Fire Response Procedures."] })],
    }),
  );

  assert.match(markup, /Shared source pages/);
  assert.match(markup, /Shares page 134 with Cargo Fire Response Procedures/);
  assert.match(markup, /does not block manual bulk approval/);
  assert.match(markup, /name="topicIds"/);
  assert.doesNotMatch(markup, /disabled="" name="topicIds"/);
});

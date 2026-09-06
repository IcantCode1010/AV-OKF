import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { OkfRelationReviewItem } from "@/lib/okf-relation-review";
import { RelationReviewWorkspace } from "./relation-review-workspace.tsx";

function item(overrides: Partial<OkfRelationReviewItem> = {}): OkfRelationReviewItem {
  return {
    automaticApprovalError: null,
    automaticApprovalRequested: false,
    confidence: 0.96,
    direction: "proposed",
    evidenceQuote: "The smoke response procedure applies to the cargo system.",
    id: "candidate-1",
    initialProposal: "Shared terms: smoke, response",
    model: "model-1",
    provider: "openai",
    publishedReview: false,
    publishedReviewStatus: null,
    rationale: "The source explicitly names the target system.",
    relation: "applies_to",
    relationDefinition: "The source explicitly applies to the target.",
    relationLabel: "Applies To",
    reviewable: true,
    sentence: "Smoke response procedure applies to Cargo system.",
    signals: ["shared_terms:smoke,response"],
    source: {
      available: true,
      description: "Response steps.",
      filePath: "concepts/procedure/smoke-response.md",
      sourceDocument: "Operations Manual",
      title: "Smoke response procedure",
      type: "Procedure",
    },
    status: "pending",
    target: {
      available: true,
      description: "Cargo system overview.",
      filePath: "concepts/system/cargo-system.md",
      sourceDocument: "Systems Manual",
      title: "Cargo system",
      type: "System",
    },
    verificationError: null,
    verificationStatus: "confirmed",
    warnings: [],
    ...overrides,
  };
}

test("relation review presents concept titles and plain-language evidence before technical details", () => {
  const markup = renderToStaticMarkup(createElement(RelationReviewWorkspace, {
    automatic: [],
    bundleId: "bundle-1",
    confirmed: [item()],
    failed: [],
    filtered: [],
    processing: [],
  }));

  assert.match(markup, /Relation status filters/);
  assert.match(markup, /Needs review/);
  assert.match(markup, /Smoke response procedure applies to Cargo system/);
  assert.match(markup, /96% confidence/);
  assert.match(markup, /The smoke response procedure applies to the cargo system/);
  assert.match(markup, /Technical details/);
  assert.match(markup, /Approve/);
  assert.match(markup, /Swap and reverify/);
  assert.match(markup, /Reject/);
  assert.match(markup, /\/knowledge\/bundle-1\/topic\?file=concepts%2Fprocedure%2Fsmoke-response.md/);
});

test("published relation review keeps the edge visible until a reviewer decides", () => {
  const markup = renderToStaticMarkup(createElement(RelationReviewWorkspace, {
    automatic: [],
    bundleId: "bundle-1",
    confirmed: [],
    failed: [],
    filtered: [],
    processing: [],
    publishedReview: [item({
      publishedReview: true,
      publishedReviewStatus: "ready",
      status: "approved",
    })],
  }));

  assert.match(markup, /Published review/);
  assert.match(markup, /remains published while its explanation is revalidated/);
  assert.match(markup, /Re-approve explanation/);
  assert.match(markup, /Reject and remove relation/);
});

test("relation review groups repeated source concepts under one heading", () => {
  const markup = renderToStaticMarkup(createElement(RelationReviewWorkspace, {
    automatic: [],
    bundleId: "bundle-1",
    confirmed: [
      item(),
      item({
        id: "candidate-2",
        sentence: "Smoke response procedure references Warning system.",
        target: {
          available: true,
          description: null,
          filePath: "concepts/system/warning-system.md",
          sourceDocument: "Systems Manual",
          title: "Warning system",
          type: "System",
        },
      }),
    ],
    failed: [],
    filtered: [],
    processing: [],
  }));

  assert.match(markup, /2 proposed relations/);
  assert.match(markup, /Cargo system/);
  assert.match(markup, /Warning system/);
});

test("unavailable concepts disable approval without hiding audit details", () => {
  const markup = renderToStaticMarkup(createElement(RelationReviewWorkspace, {
    automatic: [],
    bundleId: "bundle-1",
    confirmed: [item({ reviewable: false, target: { ...item().target, available: false } })],
    failed: [],
    filtered: [],
    processing: [],
  }));

  assert.match(markup, /cannot be approved/);
  assert.match(markup, /disabled="" type="submit">Approve/);
  assert.match(markup, /Technical details/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { DocumentProcessingPanel } from "./document-processing-panel.tsx";
import type { DocumentProcessingState } from "../../lib/document-processing-state.ts";

const readyState: DocumentProcessingState = {
  active: false,
  automaticApprovalEnabled: false,
  bundleName: "Operations Knowledge",
  currentDetail: "Topics are ready for review.",
  currentLabel: "Human review",
  headerTone: "attention",
  showHeader: true,
  stages: [
    {
      detail: "Topics are ready for review.",
      id: "review_export",
      label: "Review and export",
      status: "action_required",
    },
  ],
};

test("completed document processing continues directly into bundle topic review", () => {
  const markup = renderToStaticMarkup(
    createElement(DocumentProcessingPanel, {
      documentId: "document-1",
      extractionReady: true,
      knowledgeBundleId: "bundle-1",
      run: {
        automaticApprovalRun: null,
        errorMessage: null,
        estimatedInputTokens: 0,
        id: "run-1",
        status: "ready_for_review",
      },
      state: readyState,
      topicCount: 12,
    }),
  );

  assert.match(markup, /Review 12 topics/);
  assert.match(markup, /href="\/knowledge\/bundle-1\/review\?documentId=document-1"/);
  assert.match(markup, /ACTION REQUIRED|action required/i);
  assert.doesNotMatch(markup, /panel=topics/);
});

test("cost confirmation is a single clickable event inside the processing timeline", () => {
  const state: DocumentProcessingState = {
    ...readyState,
    currentDetail: "Review the estimated authoring cost before enrichment continues.",
    currentLabel: "Metadata discovery",
    stages: [
      {
        detail: "Review the estimated authoring cost before enrichment continues.",
        id: "metadata_discovery",
        label: "Metadata discovery",
        status: "action_required",
      },
    ],
  };
  const markup = renderToStaticMarkup(
    createElement(DocumentProcessingPanel, {
      documentId: "document-1",
      extractionReady: true,
      knowledgeBundleId: "bundle-1",
      run: {
        automaticApprovalRun: null,
        errorMessage: null,
        estimatedInputTokens: 619_617,
        id: "run-1",
        status: "awaiting_cost_confirmation",
      },
      state,
      topicCount: 0,
    }),
  );

  assert.match(markup, /Confirm 619,617 tokens and continue/);
  assert.equal(markup.match(/Confirm 619,617 tokens and continue/g)?.length, 1);
  assert.ok(markup.indexOf("Document processing stages") < markup.indexOf("Confirm 619,617 tokens and continue"));
  assert.match(markup, /name="runId" value="run-1"/);
});

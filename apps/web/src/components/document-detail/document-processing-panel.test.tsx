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
      id: "review",
      label: "Human review",
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
    }),
  );

  assert.match(markup, /Review and export topics/);
  assert.match(markup, /href="\/knowledge\/bundle-1\/review"/);
  assert.doesNotMatch(markup, /panel=topics/);
});

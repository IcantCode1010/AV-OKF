import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ChatEvidenceCard } from "./chat-evidence-card.tsx";
import { ChatSidePanelContent } from "./chat-side-panel.tsx";
import type { ChatMessage } from "../../lib/chat-types.ts";

test("evidence card separates cited authority from related unused results", () => {
  const markup = renderToStaticMarkup(createElement(ChatEvidenceCard, {
    message: message(),
  }));

  assert.match(markup, /1 cited source/);
  const sidePanel = renderToStaticMarkup(createElement(ChatSidePanelContent, {
    latestAssistantMessage: message(),
  }));
  assert.match(sidePanel, /Related, not used/);
  assert.match(sidePanel, /not cited by the answer/);
});

function message(): ChatMessage {
  return {
    citations: [{
      approvalProvenance: "human",
      documentTitle: "Approved Generator Procedure",
      index: 1,
      pageEnd: 12,
      pageStart: 12,
      sourceType: "okf",
      text: "Approved evidence.",
    }],
    content: "Use the approved procedure [1].",
    createdAt: "2026-08-14T00:00:00.000Z",
    id: "message-1",
    knowledgeBundleIds: ["bundle-1"],
    role: "assistant",
    scopeVersion: 1,
    sessionId: "session-1",
    trace: {
      confidence: "high",
      constraints: { approvedOnly: true, includeUnreviewed: false },
      queryCategory: "canonical_definition",
      rationale: "Direct approved match.",
      relatedEvidence: [{
        documentTitle: "Related Operations Manual",
        pageEnd: 40,
        pageStart: 40,
        rank: 2,
        reason: "retrieved_not_cited",
        sourceType: "rag",
        text: "Related but unused text.",
      }],
      requiredContext: [],
      retrievalToolsCalled: ["okf_retrieval"],
      route: "okf_only",
      sourcesRead: ["Approved Generator Procedure"],
      stage: "router",
    },
  };
}

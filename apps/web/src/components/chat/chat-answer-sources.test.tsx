import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatAnswerSources } from "./chat-answer-sources.tsx";
import type { ChatCitation, ChatMessage } from "../../lib/chat-types.ts";

const source: ChatCitation = { index: 1, documentTitle: "Bleed air", sourceType: "okf", knowledgeBundleId: "airbus", knowledgeBundleName: "Airbus", okfFilePath: "concepts/bleed.md", approvalProvenance: "human", pageStart: 12, pageEnd: 14, text: "Evidence" };
function render(citations: ChatCitation[]) {
  const message: ChatMessage = { id: "answer", sessionId: "chat-one", role: "assistant", content: "Answer", createdAt: "2026-09-13T00:00:00Z", knowledgeBundleIds: ["airbus"], scopeVersion: 1, citations, trace: null };
  return renderToStaticMarkup(createElement(ChatAnswerSources, { message }));
}
test("source strip retains exact OKF drilldown and conversation return path", () => {
  const html = render([source]);
  assert.match(html, /href="\/knowledge\/airbus\/topic\?file=concepts%2Fbleed.md&amp;returnTo=%2Fchat%2Fchat-one"/);
  assert.match(html, /Human-approved OKF/);
  assert.match(html, /Airbus \/ p. 12-14/);
});
test("raw documents remain unreviewed direct PDF links", () => {
  const html = render([{ ...source, sourceType: "rag", documentId: "doc-one", approvalProvenance: undefined }]);
  assert.match(html, /href="\/api\/documents\/doc-one\/file#page=12"/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /Unreviewed document/);
  assert.doesNotMatch(html, /Human-approved/);
});
test("automation and legacy trust remain distinguishable", () => {
  assert.match(render([{ ...source, approvalProvenance: "automated" }]), /Automation-approved OKF/);
  assert.match(render([{ ...source, approvalProvenance: "legacy" }]), /Legacy-approved OKF/);
});
test("withdrawn and missing source destinations cannot be opened", () => {
  const withdrawn = render([{ ...source, lifecycleNotice: "Source no longer available" }]);
  assert.doesNotMatch(withdrawn, /href=/);
  assert.match(withdrawn, /Source unavailable/);
  assert.doesNotMatch(render([{ ...source, okfFilePath: undefined }]), /href=/);
});
test("first three sources are visible, remaining sources are collapsed without losing numbering", () => {
  const html = render(Array.from({ length: 6 }, (_, index) => ({ ...source, index: index + 1 })));
  assert.equal((html.split("<details>")[0].match(/href=/g) ?? []).length, 3);
  assert.match(html, /All 6 sources/);
  assert.equal((html.match(/href=/g) ?? []).length, 6);
  assert.doesNotMatch(html, /<details open/);
  assert.equal(render([]), "");
});

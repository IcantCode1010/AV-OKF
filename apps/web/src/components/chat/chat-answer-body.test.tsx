import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatAnswerBody } from "./chat-answer-body.tsx";
import type { ChatCitation } from "../../lib/chat-types.ts";
const citation: ChatCitation = {index:1, sourceType:"rag", documentId:"doc-one", documentTitle:"Manual", pageStart:3, pageEnd:3, text:"Evidence"};
function render(content: string, citations = [citation]) { return renderToStaticMarkup(createElement(ChatAnswerBody, {message:{content,citations,sessionId:"session"}})); }
test("Markdown structure preserves citations in paragraphs, lists and tables", () => {
  const html=render("## Overview\n\nFirst paragraph [1][1].\n\nSecond **bold** paragraph.\n\n- Item [1]\n\n| Part | Source |\n| --- | --- |\n| A | [1] |");
  assert.match(html, /<h2>Overview<\/h2>/); assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<ul>/); assert.match(html, /<table/);
  assert.equal((html.match(/href="\/api\/documents\/doc-one\/file#page=3"/g) ?? []).length,4);
});
test("code and existing links do not become source links", () => {
  const html=render("`[1]`\n\n```text\n[1]\n```\n\n[Label [1]](https://example.com)");
  assert.doesNotMatch(html,/\/api\/documents/); assert.match(html,/<code>\[1\]<\/code>/);
});
test("unknown and withdrawn citations have no destination", () => {
  assert.doesNotMatch(render("[9]"),/href=/);
  assert.match(render("[9]"),/aria-label="Source 9: Source unavailable"/);
  assert.doesNotMatch(render("[1]",[{...citation,lifecycleNotice:"Withdrawn"}]),/href=/);
  assert.match(render("[1]",[{...citation,lifecycleNotice:"Withdrawn"}]),/Withdrawn/);
});
test("HTML, images and unsafe links cannot load or execute content", () => {
  const html=render('<script>alert(1)</script>\n\n![x](https://example.com/x.png)\n\n[bad](javascript:alert%281%29)');
  assert.doesNotMatch(html,/<script|<img|href="javascript:|src=/);
});
test("legacy plain paragraphs remain separate", () => {
  assert.match(render("First.\n\nSecond."),/<p>First\.<\/p>\s*<p>Second\.<\/p>/);
});

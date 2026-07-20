import assert from "node:assert/strict";
import test from "node:test";

import { getChatCitationHref } from "./chat-citation-links.ts";
import type { ChatCitation } from "./chat-types.ts";

function citation(overrides: Partial<ChatCitation>): ChatCitation {
  return {
    documentTitle: "Source",
    index: 1,
    pageEnd: 12,
    pageStart: 12,
    sourceType: "rag",
    text: "Source excerpt",
    ...overrides,
  };
}

test("raw citations link to the authenticated PDF route and page fragment", () => {
  assert.equal(
    getChatCitationHref(citation({ documentId: "doc_1" })),
    "/api/documents/doc_1/file#page=12",
  );
});

test("OKF citations link to their bundle explorer file", () => {
  assert.equal(
    getChatCitationHref(citation({
      knowledgeBundleId: "kb_1",
      okfFilePath: "concepts/system/brakes.md",
      sourceType: "okf",
    })),
    "/knowledge/kb_1?file=concepts%2Fsystem%2Fbrakes.md",
  );
});

test("lifecycle-invalid citations remain visible but are not clickable", () => {
  assert.equal(getChatCitationHref(citation({
    documentId: "doc_deleted",
    lifecycleNotice: "This source is no longer available.",
  })), null);
});

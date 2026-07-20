import assert from "node:assert/strict";
import test from "node:test";

import { annotateChatCitationLifecycle } from "./chat-citation-lifecycle.ts";
import type { ChatCitation } from "./chat-types.ts";

const citations: ChatCitation[] = [
  { documentId: "doc_deleted", documentTitle: "Deleted PDF", index: 1, pageEnd: 3, pageStart: 3, sourceType: "rag", text: "old text" },
  { documentTitle: "Old policy", index: 2, okfFilePath: "concepts/policy/old.md", pageEnd: 1, pageStart: 1, sourceType: "okf", text: "old policy" },
];

test("past citations retain content and gain notices when their sources are gone or retracted", async () => {
  const result = await annotateChatCitationLifecycle(
    { citations, knowledgeBundleId: "kb_1", workspaceId: "wrk_1" },
    {
      getActiveDocumentIds: async () => new Set(),
      getLifecycles: async () => new Map([
        ["concepts/policy/old.md", { status: "retracted" as const }],
      ]),
      okfFileExists: async () => true,
    },
  );

  assert.equal(result[0]?.text, "old text");
  assert.match(result[0]?.lifecycleNotice ?? "", /no longer available/i);
  assert.equal(result[1]?.knowledgeBundleId, "kb_1");
  assert.match(result[1]?.lifecycleNotice ?? "", /retracted after/i);
});

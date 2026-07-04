import assert from "node:assert/strict";
import test from "node:test";

import { createProductionChatService } from "./production-chat-service.ts";

const context = { role: "admin" as const, userId: "usr_1", workspaceId: "wrk_1" };

test("sendMessage stores a Stage 6A router decision and no retrieval calls", async () => {
  const appendCalls: unknown[] = [];
  const service = createProductionChatService(
    {
      appendUserMessageAndAssistantReply: async (input: unknown) => {
        appendCalls.push(input);
        return {
          assistantMessage: {
            citations: [],
            content: "This looks like an approved-knowledge question. Retrieval will be added in the next Stage 6 slice.",
            createdAt: "2026-07-04T00:00:00.000Z",
            id: "msg_assistant",
            role: "assistant",
            sessionId: "session_1",
            trace: (input as { assistantTrace: unknown }).assistantTrace,
          },
          userMessage: {
            citations: [],
            content: (input as { content: string }).content,
            createdAt: "2026-07-04T00:00:00.000Z",
            id: "msg_user",
            role: "user",
            sessionId: "session_1",
            trace: null,
          },
        };
      },
      createSession: async () => {
        throw new Error("not_used");
      },
      getSessionWithMessages: async () => {
        throw new Error("not_used");
      },
      getSessionWorkspaceId: async () => "wrk_1",
      getSessions: async () => [],
    },
    { getContext: async () => context },
  );

  const result = await service.sendMessage(
    "session_1",
    "What is the official manual path for GEN OFF BUS?",
  );

  assert.equal(appendCalls.length, 1);
  assert.deepEqual(
    (appendCalls[0] as { assistantTrace: { retrievalToolsCalled: string[] } })
      .assistantTrace.retrievalToolsCalled,
    [],
  );
  assert.equal(
    (appendCalls[0] as { assistantTrace: { route: string } }).assistantTrace.route,
    "okf_only",
  );
  assert.equal(result.assistantMessage.citations.length, 0);
  assert.match(result.assistantMessage.content, /approved-knowledge question/i);
});

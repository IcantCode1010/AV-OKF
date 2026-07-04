import assert from "node:assert/strict";
import test from "node:test";

import type { AuthWorkspaceContext } from "./auth-workspace.ts";
import type { ChatRetrievalResult } from "./chat-retrieval.ts";
import type { Stage6aRouterTrace } from "./chat-router.ts";
import type { ChatCitation, ChatMessage } from "./chat-types.ts";
import { createProductionChatService } from "./production-chat-service.ts";

const context: AuthWorkspaceContext = {
  role: "admin",
  userId: "usr_1",
  workspaceId: "wrk_1",
};

type AppendCall = {
  assistantContent: string;
  assistantTrace: Stage6aRouterTrace;
  citations: ChatCitation[];
  content: string;
  context: AuthWorkspaceContext;
  sessionId: string;
};

function createRepositoryStub() {
  const appendCalls: AppendCall[] = [];

  return {
    appendCalls,
    repository: {
      appendUserMessageAndAssistantReply: async (
        input: AppendCall,
      ): Promise<{ assistantMessage: ChatMessage; userMessage: ChatMessage }> => {
        appendCalls.push(input);
        return {
          assistantMessage: {
            citations: input.citations,
            content: input.assistantContent,
            createdAt: "2026-07-04T00:00:00.000Z",
            id: "msg_assistant",
            role: "assistant",
            sessionId: "session_1",
            trace: input.assistantTrace,
          },
          userMessage: {
            citations: [],
            content: input.content,
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
  };
}

test("sendMessage reports no evidence when retrieval finds nothing", async () => {
  const { appendCalls, repository } = createRepositoryStub();
  const service = createProductionChatService(repository, {
    getContext: async () => context,
    retrieve: async (): Promise<ChatRetrievalResult> => ({
      citations: [],
      retrievalError: false,
      retrievalToolsCalled: ["okf_retrieval"],
      sourcesRead: [],
    }),
  });

  const result = await service.sendMessage(
    "session_1",
    "What is the official manual path for GEN OFF BUS?",
  );

  assert.equal(appendCalls.length, 1);
  assert.deepEqual(appendCalls[0]?.assistantTrace.retrievalToolsCalled, ["okf_retrieval"]);
  assert.equal(appendCalls[0]?.assistantTrace.route, "okf_only");
  assert.equal(result.assistantMessage.citations.length, 0);
  assert.match(result.assistantMessage.content, /does not have a reviewed answer/i);
});

test("sendMessage builds a cited answer from retrieval results", async () => {
  const { appendCalls, repository } = createRepositoryStub();
  const service = createProductionChatService(repository, {
    getContext: async () => context,
    retrieve: async (): Promise<ChatRetrievalResult> => ({
      citations: [
        {
          documentTitle: "737NG QRH",
          index: 1,
          pageEnd: 12,
          pageStart: 12,
          sourceType: "okf",
          text: "GEN OFF BUS light indicates a generator bus fault.",
        },
      ],
      retrievalError: false,
      retrievalToolsCalled: ["okf_retrieval"],
      sourcesRead: ["737NG QRH (p. 12)"],
    }),
  });

  const result = await service.sendMessage(
    "session_1",
    "What is the official manual path for GEN OFF BUS?",
  );

  assert.equal(appendCalls.length, 1);
  assert.equal(result.assistantMessage.citations.length, 1);
  assert.match(result.assistantMessage.content, /\[1\]/);
  assert.match(result.assistantMessage.content, /generator bus fault/i);
  assert.deepEqual(appendCalls[0]?.assistantTrace.sourcesRead, ["737NG QRH (p. 12)"]);
});

test("sendMessage does not run retrieval for missing-context routes", async () => {
  const { appendCalls, repository } = createRepositoryStub();
  const service = createProductionChatService(repository, {
    getContext: async () => context,
    retrieve: async () => {
      throw new Error("retrieve_should_not_be_called");
    },
  });

  const result = await service.sendMessage("session_1", "Can we dispatch?");

  assert.equal(appendCalls.length, 1);
  assert.equal(appendCalls[0]?.assistantTrace.route, "missing_context");
  assert.equal(result.assistantMessage.citations.length, 0);
  assert.match(result.assistantMessage.content, /need a little more context/i);
});

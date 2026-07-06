import assert from "node:assert/strict";
import test from "node:test";

import type { AuthWorkspaceContext } from "./auth-workspace.ts";
import { generateChatAnswer } from "./chat-answer.ts";
import type { ChatRetrievalResult } from "./chat-retrieval.ts";
import type { Stage6aRouterTrace } from "./chat-router.ts";
import type { ChatCitation, ChatMessage } from "./chat-types.ts";
import { createProductionChatService } from "./production-chat-service.ts";

// Runs the real answer builder but hermetically: no workspace key lookup,
// so it always takes the deterministic fallback path.
const generateAnswerWithoutKey: typeof generateChatAnswer = async (input) =>
  generateChatAnswer(input, { getApiKey: async () => null });

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
      getSessionWithMessages: async () => ({
        messages: [] as ChatMessage[],
        session: {
          createdAt: "2026-07-04T00:00:00.000Z",
          id: "session_1",
          title: "New chat",
          updatedAt: "2026-07-04T00:00:00.000Z",
          userId: "usr_1",
          workspaceId: "wrk_1",
        },
      }),
      getSessionWorkspaceId: async () => "wrk_1",
      getSessions: async () => [],
    },
  };
}

test("sendMessage reports no evidence when retrieval finds nothing", async () => {
  const { appendCalls, repository } = createRepositoryStub();
  const service = createProductionChatService(repository, {
    generateAnswer: generateAnswerWithoutKey,
    getContext: async () => context,
    retrieve: async (): Promise<ChatRetrievalResult> => ({
      approvedOkfAvailable: false,
      citations: [],
      evidence: [],
      ragUsedForDiscoveryOnly: false,
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
  assert.equal(appendCalls[0]?.assistantTrace.answerMode, "deterministic");
  assert.equal(appendCalls[0]?.assistantTrace.approvedOkfAvailable, false);
  assert.equal(appendCalls[0]?.assistantTrace.finalEvidenceStatus, "no_evidence");
  assert.equal(result.assistantMessage.citations.length, 0);
  assert.match(result.assistantMessage.content, /does not have a reviewed answer/i);
});

function citedRetrievalResult(): ChatRetrievalResult {
  return {
    approvedOkfAvailable: true,
    ragUsedForDiscoveryOnly: false,
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
    evidence: [
      {
        documentTitle: "737NG QRH",
        index: 1,
        pageEnd: 12,
        pageStart: 12,
        sourceType: "okf",
        text: "GEN OFF BUS light indicates a generator bus fault. Reset per QRH 6.2.",
      },
    ],
    retrievalError: false,
    retrievalToolsCalled: ["okf_retrieval"],
    sourcesRead: ["737NG QRH (p. 12)"],
  };
}

test("sendMessage builds a cited answer from retrieval results", async () => {
  const { appendCalls, repository } = createRepositoryStub();
  const service = createProductionChatService(repository, {
    generateAnswer: generateAnswerWithoutKey,
    getContext: async () => context,
    retrieve: async () => citedRetrievalResult(),
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

test("sendMessage stores the LLM answer and records answer mode in the trace", async () => {
  const { appendCalls, repository } = createRepositoryStub();
  const service = createProductionChatService(repository, {
    generateAnswer: async (input) =>
      generateChatAnswer(input, {
        callProvider: async () =>
          '{"answer": "The GEN OFF BUS light indicates a generator bus fault [1].", "supported": true}',
        getApiKey: async () => ({ apiKey: "sk-test", provider: "openai" }),
      }),
    getContext: async () => context,
    retrieve: async () => citedRetrievalResult(),
  });

  const result = await service.sendMessage(
    "session_1",
    "What is the official manual path for GEN OFF BUS?",
  );

  assert.equal(
    result.assistantMessage.content,
    "The GEN OFF BUS light indicates a generator bus fault [1].",
  );
  assert.equal(appendCalls[0]?.assistantTrace.answerMode, "llm");
  assert.equal(appendCalls[0]?.assistantTrace.answerProvider, "openai");
  assert.ok(appendCalls[0]?.assistantTrace.answerModel);
  assert.equal(appendCalls[0]?.assistantTrace.approvedOkfAvailable, true);
  assert.equal(appendCalls[0]?.assistantTrace.finalEvidenceStatus, "approved_evidence");
  assert.equal(appendCalls[0]?.assistantTrace.ragUsedForDiscoveryOnly, false);
  assert.equal(
    appendCalls[0]?.assistantTrace.answerEvidenceProfile?.evidenceKind,
    "approved_okf",
  );
  assert.equal(
    appendCalls[0]?.assistantTrace.answerEvidenceProfile?.trustLevel,
    "high",
  );
});

test("sendMessage falls back to the deterministic answer when the LLM call fails", async () => {
  const { appendCalls, repository } = createRepositoryStub();
  const service = createProductionChatService(repository, {
    generateAnswer: async (input) =>
      generateChatAnswer(input, {
        callProvider: async () => {
          throw new Error("openai_request_failed:500");
        },
        getApiKey: async () => ({ apiKey: "sk-test", provider: "openai" }),
      }),
    getContext: async () => context,
    retrieve: async () => citedRetrievalResult(),
  });

  const result = await service.sendMessage(
    "session_1",
    "What is the official manual path for GEN OFF BUS?",
  );

  assert.equal(appendCalls[0]?.assistantTrace.answerMode, "deterministic");
  assert.equal(appendCalls[0]?.assistantTrace.answerProvider, undefined);
  assert.match(result.assistantMessage.content, /generator bus fault/i);
  assert.match(result.assistantMessage.content, /\[1\]/);
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
  assert.equal(appendCalls[0]?.assistantTrace.answerMode, "deterministic");
  assert.equal(appendCalls[0]?.assistantTrace.finalEvidenceStatus, undefined);
  assert.equal(result.assistantMessage.citations.length, 0);
  assert.match(result.assistantMessage.content, /need a little more context/i);
});

test("sendMessage can use an LLM fallback router decision for low-confidence questions", async () => {
  const { appendCalls, repository } = createRepositoryStub();
  const service = createProductionChatService(repository, {
    generateAnswer: generateAnswerWithoutKey,
    getContext: async () => context,
    retrieve: async (input) => {
      assert.equal(input.decision.route, "rag_only");
      return {
        ...citedRetrievalResult(),
        approvedOkfAvailable: false,
        citations: [
          {
            documentTitle: "737NG AMM",
            index: 1,
            pageEnd: 33,
            pageStart: 32,
            sourceType: "rag",
            text: "Generator bus reset is discussed in the electrical chapter.",
          },
        ],
        evidence: [
          {
            documentTitle: "737NG AMM",
            index: 1,
            pageEnd: 33,
            pageStart: 32,
            sourceType: "rag",
            text: "Generator bus reset is discussed in the electrical chapter.",
          },
        ],
        ragUsedForDiscoveryOnly: true,
        retrievalToolsCalled: ["rag_retrieval"],
        sourcesRead: ["737NG AMM (p. 32-33)"],
      };
    },
    routeQuestion: async () => ({
      confidence: "medium",
      constraints: { approvedOnly: false, includeUnreviewed: true },
      queryCategory: "open_ended_discovery",
      rationale: "LLM fallback treated this as a document discovery query.",
      requiredContext: [],
      route: "rag_only",
      routerMode: "llm_fallback",
    }),
  });

  const result = await service.sendMessage("session_1", "generator bus reset");

  assert.equal(appendCalls[0]?.assistantTrace.route, "rag_only");
  assert.equal(appendCalls[0]?.assistantTrace.routerMode, "llm_fallback");
  assert.equal(appendCalls[0]?.assistantTrace.finalEvidenceStatus, "discovery_evidence");
  assert.equal(
    appendCalls[0]?.assistantTrace.answerEvidenceProfile?.evidenceKind,
    "raw_rag",
  );
  assert.equal(result.assistantMessage.citations[0]?.sourceType, "rag");
});

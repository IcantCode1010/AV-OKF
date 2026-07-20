import assert from "node:assert/strict";
import test from "node:test";

import type { AuthWorkspaceContext } from "./auth-workspace.ts";
import { generateChatAnswer } from "./chat-answer.ts";
import type { ChatRetrievalResult } from "./chat-retrieval.ts";
import type {
  ChatQueryUnderstandingTrace,
  Stage6aRouterTrace,
} from "./chat-router.ts";
import type { ChatCitation, ChatMessage } from "./chat-types.ts";
import {
  createProductionChatService,
  getClarificationState,
  validateMetadataClarificationSelection,
} from "./production-chat-service.ts";

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

function createRepositoryStub(initialMessages: ChatMessage[] = []) {
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
        messages: initialMessages,
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

function fallbackQueryUnderstanding(
  question: string,
  overrides: Partial<ChatQueryUnderstandingTrace> = {},
): ChatQueryUnderstandingTrace {
  return {
    ambiguityLevel: "high",
    assumptions: [],
    detectedEntities: [],
    originalQuestion: question,
    retrievalQuery: question,
    rewriteMode: "fallback_original",
    warnings: [],
    ...overrides,
  };
}

function historyMessage(input: {
  content: string;
  id: string;
  role: "assistant" | "user";
  metadataClarification?: Stage6aRouterTrace["metadataClarification"];
  route?: Stage6aRouterTrace["route"];
}): ChatMessage {
  return {
    citations: [],
    content: input.content,
    createdAt: "2026-07-04T00:00:00.000Z",
    id: input.id,
    role: input.role,
    sessionId: "session_1",
    trace:
      input.role === "assistant" && input.route
        ? {
            confidence: "high",
            constraints: { approvedOnly: true, includeUnreviewed: false },
            queryCategory: input.route === "missing_context"
              ? "missing_context"
              : "canonical_definition",
            rationale: "test trace",
            requiredContext: [],
            retrievalToolsCalled: [],
            ...(input.metadataClarification
              ? { metadataClarification: input.metadataClarification }
              : {}),
            route: input.route,
            sourcesRead: [],
            stage: "router",
          }
        : null,
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
    okfEvidenceMode: "direct",
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
    rerank: { applied: false, dropped: 0, status: "not_applicable" },
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
  assert.equal(appendCalls[0]?.assistantTrace.okfEvidenceMode, "direct");
  assert.equal(appendCalls[0]?.assistantTrace.rerank?.status, "not_applicable");
});

test("metadata clarification never reaches answer generation or evidence validation", async () => {
  const { appendCalls, repository } = createRepositoryStub();
  let answerCalled = false;
  let validationCalled = false;
  const service = createProductionChatService(repository, {
    generateAnswer: async () => {
      answerCalled = true;
      throw new Error("near_miss_must_not_reach_answer");
    },
    getContext: async () => context,
    retrieve: async () => ({
      approvedOkfAvailable: false,
      citations: [],
      evidence: [],
      metadataClarification: {
        candidateCount: 2,
        fields: [{
          field: "subject_family",
          label: "Subject or family",
          options: ["Automobile", "Forklift"],
        }],
        question: "Which subject or family applies?",
      },
      ragUsedForDiscoveryOnly: false,
      rerank: { applied: false, dropped: 0, status: "not_applicable" },
      retrievalError: false,
      retrievalToolsCalled: ["okf_retrieval"],
      sourcesRead: [],
    }),
    validateAnswer: () => {
      validationCalled = true;
      throw new Error("near_miss_must_not_reach_validation");
    },
  });

  const result = await service.sendMessage(
    "session_1",
    "What is the approved hydraulic fuse guidance?",
  );

  assert.equal(answerCalled, false);
  assert.equal(validationCalled, false);
  assert.deepEqual(result.assistantMessage.citations, []);
  assert.equal(result.assistantMessage.content, "Which subject or family applies?");
  assert.equal(appendCalls[0]?.assistantTrace.finalEvidenceStatus, "weak_evidence");
  assert.equal(appendCalls[0]?.assistantTrace.answerValidation, undefined);
  assert.equal(
    appendCalls[0]?.assistantTrace.queryUnderstanding?.clarifyingQuestion,
    "Which subject or family applies?",
  );
});

test("metadata clarification consumes the existing one-round gate and validates selections", () => {
  const clarification = {
    candidateCount: 2,
    fields: [{
      field: "subject_family",
      label: "Subject or family",
      options: ["Automobile", "Forklift"],
    }],
    question: "Which subject or family applies?",
  };
  const messages = [
    historyMessage({ content: "What guidance applies?", id: "u1", role: "user" }),
    historyMessage({
      content: clarification.question,
      id: "a1",
      metadataClarification: clarification,
      role: "assistant",
      route: "okf_only",
    }),
  ];

  assert.deepEqual(getClarificationState(messages), {
    alreadyAsked: true,
    originQuestion: "What guidance applies?",
  });
  assert.deepEqual(
    validateMetadataClarificationSelection(messages, [{
      field: "subject_family",
      label: "Subject or family",
      value: "Forklift",
    }]),
    [{
      field: "subject_family",
      label: "Subject or family",
      value: "Forklift",
    }],
  );
  assert.throws(
    () => validateMetadataClarificationSelection(messages, [{
      field: "subject_family",
      label: "Subject or family",
      value: "Invented",
    }]),
    /metadata_clarification_selection_invalid/,
  );
});

test("sendMessage stores the LLM answer and records answer mode in the trace", async () => {
  const { appendCalls, repository } = createRepositoryStub();
  const service = createProductionChatService(repository, {
    generateAnswer: async (input) =>
      generateChatAnswer(input, {
        callProvider: async () =>
          ({
            answer: "The GEN OFF BUS light indicates a generator bus fault [1].",
            supported: true,
          }),
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

test("sendMessage falls back when a generated answer violates the evidence contract", async () => {
  const { appendCalls, repository } = createRepositoryStub();
  const service = createProductionChatService(repository, {
    generateAnswer: async () => ({
      content: "The system is operational without a citation.",
      mode: "llm" as const,
      model: "test-model",
      provider: "openai" as const,
    }),
    getContext: async () => context,
    retrieve: async () => citedRetrievalResult(),
  });

  const result = await service.sendMessage(
    "session_1",
    "What is the official manual path for GEN OFF BUS?",
  );

  assert.equal(appendCalls[0]?.assistantTrace.answerMode, "deterministic");
  assert.equal(appendCalls[0]?.assistantTrace.answerValidation?.status, "fail");
  assert.ok(
    appendCalls[0]?.assistantTrace.answerValidation?.violations.includes(
      "answer_missing_valid_citation_marker",
    ),
  );
  assert.match(result.assistantMessage.content, /generator bus fault/i);
  assert.match(result.assistantMessage.content, /\[1\]/);
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
    understandQuery: async ({ question }) => fallbackQueryUnderstanding(question),
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
    understandQuery: async ({ question }) => fallbackQueryUnderstanding(question),
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

test("sendMessage uses the optimized query internally while preserving user input", async () => {
  const { appendCalls, repository } = createRepositoryStub();
  let retrievalQuery = "";
  let answerQuery = "";
  const originalQuestion = "GEN OFF BUS reset";
  const service = createProductionChatService(repository, {
    generateAnswer: async (input) => {
      answerQuery = input.query;
      return {
        content: "The generator bus reset is described in the source [1].",
        mode: "llm",
        model: "test-model",
        provider: "openai",
      };
    },
    getContext: async () => context,
    retrieve: async (input) => {
      retrievalQuery = input.query;
      return citedRetrievalResult();
    },
    routeQuestion: async () => ({
      confidence: "medium",
      constraints: { approvedOnly: true, includeUnreviewed: false },
      queryCategory: "canonical_definition",
      rationale: "LLM fallback retained approved-first routing.",
      requiredContext: [],
      route: "okf_only",
      routerMode: "llm_fallback",
    }),
    understandQuery: async ({ question }) =>
      fallbackQueryUnderstanding(question, {
        ambiguityLevel: "medium",
        detectedEntities: ["GEN", "OFF", "BUS"],
        retrievalQuery: "GEN OFF BUS generator reset procedure",
        rewriteMode: "llm",
      }),
  });

  await service.sendMessage("session_1", originalQuestion);

  assert.equal(appendCalls[0]?.content, originalQuestion);
  assert.equal(retrievalQuery, "GEN OFF BUS generator reset procedure");
  assert.equal(answerQuery, "GEN OFF BUS generator reset procedure");
  assert.equal(
    appendCalls[0]?.assistantTrace.queryUnderstanding?.retrievalQuery,
    "GEN OFF BUS generator reset procedure",
  );
});

test("first vague question asks one combined generic clarification without retrieval", async () => {
  const { repository } = createRepositoryStub();
  const service = createProductionChatService(repository, {
    getContext: async () => context,
    retrieve: async () => {
      throw new Error("retrieve_should_not_be_called");
    },
    understandQuery: async ({ question }) =>
      fallbackQueryUnderstanding(question, {
        clarifyingQuestion:
          "Which subject, scope or version, source authority, and intended action apply?",
        rewriteMode: "llm",
      }),
  });

  const result = await service.sendMessage("session_1", "Can we approve this?");

  assert.equal(
    result.assistantMessage.content,
    "Which subject, scope or version, source authority, and intended action apply?",
  );
});

test("clarification history resolves the originating user question", () => {
  const messages = [
    historyMessage({ content: "Can we approve this?", id: "u1", role: "user" }),
    historyMessage({
      content: "Please provide more context.",
      id: "a1",
      role: "assistant",
      route: "missing_context",
    }),
  ];

  assert.deepEqual(getClarificationState(messages), {
    alreadyAsked: true,
    originQuestion: "Can we approve this?",
  });
  assert.deepEqual(getClarificationState([]), { alreadyAsked: false });
});

test("completed clarification history does not reuse the old origin question", () => {
  const messages = [
    historyMessage({ content: "Can we approve this?", id: "u1", role: "user" }),
    historyMessage({
      content: "Please provide more context.",
      id: "a1",
      role: "assistant",
      route: "missing_context",
    }),
    historyMessage({ content: "Use version 2.", id: "u2", role: "user" }),
    historyMessage({
      content: "Version 2 is covered by approved knowledge.",
      id: "a2",
      role: "assistant",
      route: "okf_only",
    }),
  ];

  assert.deepEqual(getClarificationState(messages), { alreadyAsked: true });
});

test("a clear later question skips optimization and assumption disclosure", async () => {
  const history = [
    historyMessage({ content: "Can we approve this?", id: "u1", role: "user" }),
    historyMessage({
      content: "Please provide more context.",
      id: "a1",
      role: "assistant",
      route: "missing_context",
    }),
    historyMessage({ content: "Use version 2.", id: "u2", role: "user" }),
    historyMessage({
      content: "Version 2 is covered by approved knowledge.",
      id: "a2",
      role: "assistant",
      route: "okf_only",
    }),
  ];
  const { repository } = createRepositoryStub(history);
  const service = createProductionChatService(repository, {
    generateAnswer: generateAnswerWithoutKey,
    getContext: async () => context,
    retrieve: async () => citedRetrievalResult(),
    understandQuery: async () => {
      throw new Error("query_understanding_should_not_run");
    },
  });

  const result = await service.sendMessage(
    "session_1",
    "What does ground leveling mean in the forklift manual?",
  );

  assert.equal(result.assistantMessage.trace?.queryUnderstanding?.rewriteMode, "not_needed");
  assert.deepEqual(result.assistantMessage.trace?.queryUnderstanding?.assumptions, []);
  assert.doesNotMatch(result.assistantMessage.content, /Assumptions used/);
});

test("complete clarification follow-up routes normally without assumption text", async () => {
  const history = [
    historyMessage({ content: "Can we approve this?", id: "u1", role: "user" }),
    historyMessage({
      content: "Please provide more context.",
      id: "a1",
      role: "assistant",
      route: "missing_context",
    }),
  ];
  const { repository } = createRepositoryStub(history);
  let retrievalQuery = "";
  const service = createProductionChatService(repository, {
    generateAnswer: generateAnswerWithoutKey,
    getContext: async () => context,
    retrieve: async (input) => {
      retrievalQuery = input.query;
      return citedRetrievalResult();
    },
    understandQuery: async (input) => {
      assert.equal(input.clarificationAlreadyAsked, true);
      assert.equal(input.clarificationOriginQuestion, "Can we approve this?");
      return fallbackQueryUnderstanding(input.question, {
        ambiguityLevel: "low",
        assumptions: [],
        retrievalQuery: "Policy POL-SEC-104 version 2 employee access approval",
        rewriteMode: "llm",
      });
    },
  });

  const result = await service.sendMessage(
    "session_1",
    "Policy POL-SEC-104 version 2 for employee access.",
  );

  assert.match(retrievalQuery, /POL-SEC-104/);
  assert.doesNotMatch(result.assistantMessage.content, /Assumptions used/);
});

test("incomplete follow-up retrieves once with specific visible assumptions", async () => {
  const history = [
    historyMessage({ content: "Can we approve this?", id: "u1", role: "user" }),
    historyMessage({
      content: "Please provide more context.",
      id: "a1",
      role: "assistant",
      route: "missing_context",
    }),
  ];
  const { repository } = createRepositoryStub(history);
  let retrievalQuery = "";
  const service = createProductionChatService(repository, {
    generateAnswer: generateAnswerWithoutKey,
    getContext: async () => context,
    retrieve: async (input) => {
      retrievalQuery = input.query;
      return citedRetrievalResult();
    },
    understandQuery: async ({ question }) =>
      fallbackQueryUnderstanding(question, {
        assumptions: [
          {
            basis: "conversation",
            field: "applicable_scope_or_version",
            value: "version 2",
          },
          {
            basis: "safe_default",
            field: "intended_action",
            value: "informational guidance only, not authorization to act",
          },
        ],
        retrievalQuery: "approval policy version 2",
        rewriteMode: "llm",
      }),
  });

  const result = await service.sendMessage("session_1", "Use version 2.");

  assert.equal(result.assistantMessage.trace?.route, "okf_only");
  assert.match(retrievalQuery, /version 2/);
  assert.match(result.assistantMessage.content, /applicable scope or version: version 2/i);
  assert.match(
    result.assistantMessage.content,
    /intended action: informational guidance only, not authorization to act/i,
  );
});

test("a repeated subjectless follow-up does not search, synthesize, or ask another formal clarification", async () => {
  const history = [
    historyMessage({ content: "Can we approve this?", id: "u1", role: "user" }),
    historyMessage({
      content: "Please provide more context.",
      id: "a1",
      role: "assistant",
      route: "missing_context",
    }),
    historyMessage({ content: "Use version 2.", id: "u2", role: "user" }),
    historyMessage({
      content: "Assuming version 2, no evidence was found.",
      id: "a2",
      role: "assistant",
      route: "okf_only",
    }),
  ];
  const { repository } = createRepositoryStub(history);
  let retrievalCalls = 0;
  let answerCalls = 0;
  const service = createProductionChatService(repository, {
    generateAnswer: async () => {
      answerCalls += 1;
      throw new Error("generate_answer_should_not_be_called");
    },
    getContext: async () => context,
    retrieve: async () => {
      retrievalCalls += 1;
      return citedRetrievalResult();
    },
    understandQuery: async () => {
      throw new Error("query_understanding_should_not_be_called");
    },
  });

  const result = await service.sendMessage("session_1", "What about that?");

  assert.notEqual(result.assistantMessage.trace?.route, "missing_context");
  assert.equal(retrievalCalls, 0);
  assert.equal(answerCalls, 0);
  assert.deepEqual(result.assistantMessage.citations, []);
  assert.deepEqual(result.assistantMessage.trace?.queryUnderstanding?.assumptions, []);
  assert.deepEqual(result.assistantMessage.trace?.retrievalToolsCalled, []);
  assert.deepEqual(result.assistantMessage.trace?.queryUnderstanding?.warnings, [
    "unresolved_vague_follow_up",
  ]);
  assert.match(result.assistantMessage.content, /cannot identify the subject/i);
  assert.match(result.assistantMessage.content, /document, topic, policy, product/i);
  assert.doesNotMatch(result.assistantMessage.content, /Assumptions used/i);
});

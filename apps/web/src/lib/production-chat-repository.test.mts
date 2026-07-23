import assert from "node:assert/strict";
import test from "node:test";

import { buildStage6aRouterTrace, routeChatQuestion } from "./chat-router.ts";
import {
  createPostgresChatRepository,
  deriveChatSessionTitle,
} from "./production-chat-repository.ts";

const context = { role: "admin" as const, userId: "usr_1", workspaceId: "wrk_1" };
const knowledgeBundleId = "kb_general";

test("deriveChatSessionTitle normalizes first-message text and truncates deterministically", () => {
  assert.equal(
    deriveChatSessionTitle("  What\u00a0does\n ground leveling mean?  "),
    "What does ground leveling mean?",
  );
  assert.equal(deriveChatSessionTitle(" \n\t "), "New chat");
  assert.equal(
    deriveChatSessionTitle("A".repeat(80)),
    `${"A".repeat(69)}...`,
  );
});

test("createSession scopes workspaceId and userId from context", async () => {
  const calls: unknown[] = [];
  const repository = createPostgresChatRepository({
    chatSession: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        calls.push(data);
        return {
          createdAt: new Date("2026-07-04T00:00:00.000Z"),
          id: "session_1",
          title: data.title,
          updatedAt: new Date("2026-07-04T00:00:00.000Z"),
          userId: data.userId,
          workspaceId: data.workspaceId,
        };
      },
    },
  });

  const session = await repository.createSession({ context, knowledgeBundleId });

  assert.deepEqual(calls, [
    {
      knowledgeBundles: {
        create: {
          knowledgeBundleId,
          position: 0,
          selectedBy: "usr_1",
        },
      },
      primaryKnowledgeBundleId: knowledgeBundleId,
      title: "New chat",
      userId: "usr_1",
      workspaceId: "wrk_1",
    },
  ]);
  assert.equal(session.title, "New chat");
});

test("createSession trims a provided title and falls back when blank", async () => {
  const repository = createPostgresChatRepository({
    chatSession: {
      create: async ({ data }: { data: Record<string, unknown> }) => ({
        createdAt: new Date(),
        id: "session_1",
        title: data.title,
        updatedAt: new Date(),
        userId: data.userId,
        workspaceId: data.workspaceId,
      }),
    },
  });

  const trimmed = await repository.createSession({
    context,
    knowledgeBundleId,
    title: "  Reverser question  ",
  });
  const blank = await repository.createSession({ context, knowledgeBundleId, title: "   " });

  assert.equal(trimmed.title, "Reverser question");
  assert.equal(blank.title, "New chat");
});

test("createSession fails closed when no knowledge bundle is supplied", async () => {
  const repository = createPostgresChatRepository({
    chatSession: {
      create: async () => assert.fail("chat session must not be written"),
    },
  });

  await assert.rejects(
    () => repository.createSession({ context }),
    /chat_bundle_required/,
  );
});

test("getSessionWorkspaceId returns undefined for a missing session", async () => {
  const repository = createPostgresChatRepository({
    chatSession: {
      findUnique: async () => null,
    },
  });

  const workspaceId = await repository.getSessionWorkspaceId("session_missing");

  assert.equal(workspaceId, undefined);
});

test("getSessionWithMessages rejects a session belonging to another workspace", async () => {
  const repository = createPostgresChatRepository({
    chatSession: {
      findFirst: async () => null,
    },
  });

  await assert.rejects(
    () =>
      repository.getSessionWithMessages({
        context,
        sessionId: "session_other_workspace",
      }),
    /chat_session_not_found/,
  );
});

test("updateKnowledgeBundleScope atomically preserves order and increments the scope version", async () => {
  let selectedIds = [knowledgeBundleId];
  let scopeVersion = 1;
  const selectedBy: string[] = [];
  const record = () => ({
    createdAt: new Date("2026-07-04T00:00:00.000Z"),
    id: "session_1",
    knowledgeBundles: selectedIds.map((id, position) => ({
      knowledgeBundle: { id, name: id === "kb_regulations" ? "Regulations" : "General" },
      position,
    })),
    primaryKnowledgeBundleId: selectedIds[0] ?? null,
    scopeVersion,
    title: "Scope test",
    updatedAt: new Date("2026-07-04T00:00:00.000Z"),
    userId: "usr_1",
    workspaceId: "wrk_1",
  });
  const repository = createPostgresChatRepository({
    chatSession: {
      findFirst: async () => record(),
    },
    knowledgeBundle: {
      findMany: async () =>
        ["kb_regulations", knowledgeBundleId].map((id) => ({ id })),
    },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        chatSession: {
          update: async () => {
            scopeVersion += 1;
          },
        },
        chatSessionKnowledgeBundle: {
          createMany: async ({ data }: {
            data: Array<{ knowledgeBundleId: string; selectedBy: string }>;
          }) => {
            selectedIds = data.map((item) => item.knowledgeBundleId);
            selectedBy.push(...data.map((item) => item.selectedBy));
          },
          deleteMany: async () => {
            selectedIds = [];
          },
        },
      }),
  });

  const session = await repository.updateKnowledgeBundleScope({
    context,
    knowledgeBundleIds: ["kb_regulations", knowledgeBundleId],
    sessionId: "session_1",
  });

  assert.deepEqual(
    session.knowledgeBundles.map((bundle) => bundle.id),
    ["kb_regulations", knowledgeBundleId],
  );
  assert.equal(session.primaryKnowledgeBundleId, "kb_regulations");
  assert.equal(session.scopeVersion, 2);
  assert.deepEqual(selectedBy, ["usr_1", "usr_1"]);
});

test("updateKnowledgeBundleScope rejects duplicates, cross-workspace ids, and more than ten bundles", async () => {
  const repository = createPostgresChatRepository({
    chatSession: {
      findFirst: async () => ({
        createdAt: new Date(),
        id: "session_1",
        knowledgeBundles: [],
        primaryKnowledgeBundleId: knowledgeBundleId,
        scopeVersion: 1,
        title: "Scope test",
        updatedAt: new Date(),
        userId: "usr_1",
        workspaceId: "wrk_1",
      }),
    },
    knowledgeBundle: {
      findMany: async () => [{ id: knowledgeBundleId }],
    },
    $transaction: async () => assert.fail("invalid scope must not be written"),
  });

  await assert.rejects(
    repository.updateKnowledgeBundleScope({
      context,
      knowledgeBundleIds: [knowledgeBundleId, knowledgeBundleId],
      sessionId: "session_1",
    }),
    /chat_bundle_scope_invalid/,
  );
  await assert.rejects(
    repository.updateKnowledgeBundleScope({
      context,
      knowledgeBundleIds: [knowledgeBundleId, "kb_other_workspace"],
      sessionId: "session_1",
    }),
    /chat_bundle_scope_invalid/,
  );
  await assert.rejects(
    repository.updateKnowledgeBundleScope({
      context,
      knowledgeBundleIds: Array.from({ length: 11 }, (_, index) => `kb_${index}`),
      sessionId: "session_1",
    }),
    /chat_bundle_scope_invalid/,
  );
});

test("appendUserMessageAndAssistantReply inserts messages and assigns the first-message title atomically", async () => {
  const calls: string[] = [];
  const sessionWrites: Record<string, unknown>[] = [];
  const assistantTrace = buildStage6aRouterTrace(
    routeChatQuestion("What is the official manual path for GEN OFF BUS?"),
  );
  const repository = createPostgresChatRepository({
    chatSession: {
      findFirst: async () => ({
        createdAt: new Date(),
        id: "session_1",
        title: "New chat",
        updatedAt: new Date(),
        userId: "usr_1",
        workspaceId: "wrk_1",
      }),
    },
    $transaction: async (
      callback: (tx: unknown) => Promise<unknown>,
    ) =>
      callback({
        chatMessage: {
          create: async ({ data }: { data: Record<string, unknown> }) => {
            calls.push(`message.create:${data.role}`);
            return {
              citations: [],
              content: data.content,
              createdAt: new Date(),
              id: `msg_${data.role}`,
              role: data.role,
              sessionId: data.sessionId,
              trace: data.trace ?? null,
            };
          },
        },
        chatSession: {
          updateMany: async ({ data, where }: {
            data: Record<string, unknown>;
            where: Record<string, unknown>;
          }) => {
            calls.push("session.updateMany");
            sessionWrites.push({ data, where });
            return { count: 1 };
          },
          update: async () => {
            calls.push("session.update");
          },
        },
        knowledgeGap: {
          create: async () => {
            calls.push("knowledgeGap.create");
          },
        },
      }),
  });

  const result = await repository.appendUserMessageAndAssistantReply({
    assistantContent: "This looks like an approved-knowledge question.",
    assistantTrace,
    citations: [],
    content: "What's the procedure for REVERSER UNLOCKED IN FLIGHT?",
    context,
    knowledgeBundleIds: [knowledgeBundleId],
    primaryKnowledgeBundleId: knowledgeBundleId,
    scopeVersion: 1,
    sessionId: "session_1",
  });

  assert.deepEqual(calls, [
    "message.create:user",
    "message.create:assistant",
    "session.updateMany",
  ]);
  assert.equal(sessionWrites[0]?.data && (sessionWrites[0].data as Record<string, unknown>).title, "What's the procedure for REVERSER UNLOCKED IN FLIGHT?");
  assert.deepEqual(
    sessionWrites[0]?.where,
    { id: "session_1", title: "New chat", workspaceId: "wrk_1" },
  );
  assert.equal(result.userMessage.role, "user");
  assert.equal(
    result.userMessage.content,
    "What's the procedure for REVERSER UNLOCKED IN FLIGHT?",
  );
  assert.equal(result.assistantMessage.role, "assistant");
  assert.equal(
    result.assistantMessage.content,
    "This looks like an approved-knowledge question.",
  );
  assert.deepEqual(result.assistantMessage.citations, []);
  assert.deepEqual(result.assistantMessage.trace, assistantTrace);
});

test("appendUserMessageAndAssistantReply stores a knowledge gap in the message transaction", async () => {
  const writes: Record<string, unknown>[] = [];
  const repository = createPostgresChatRepository({
    chatSession: {
      findFirst: async () => ({
        createdAt: new Date(),
        id: "session_1",
        knowledgeBundleId,
        title: "New chat",
        updatedAt: new Date(),
        userId: "usr_1",
        workspaceId: "wrk_1",
      }),
    },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        chatMessage: {
          create: async ({ data }: { data: Record<string, unknown> }) => ({
            citations: data.citations ?? [],
            content: data.content,
            createdAt: new Date(),
            id: data.role === "assistant" ? "msg_assistant" : "msg_user",
            role: data.role,
            sessionId: data.sessionId,
            trace: data.trace ?? null,
          }),
        },
        chatSession: {
          updateMany: async () => ({ count: 0 }),
          update: async () => undefined,
        },
        knowledgeGap: {
          create: async ({ data }: { data: Record<string, unknown> }) => {
            writes.push(data);
          },
        },
      }),
  });

  await repository.appendUserMessageAndAssistantReply({
    assistantContent: "Not enough evidence.",
    assistantTrace: buildStage6aRouterTrace(
      routeChatQuestion("What is the official missing procedure?"),
    ),
    citations: [],
    content: "What is the official missing procedure?",
    context,
    knowledgeBundleIds: [knowledgeBundleId],
    knowledgeGap: {
      finalEvidenceStatus: "no_evidence",
      question: "What is the official missing procedure?",
      reason: "no_matching_evidence",
      retrievalQuery: "official missing procedure",
      route: "okf_only",
      searchedSources: ["okf_retrieval", "rag_retrieval"],
    },
    primaryKnowledgeBundleId: knowledgeBundleId,
    scopeVersion: 1,
    sessionId: "session_1",
  });

  assert.deepEqual(writes, [{
    assistantMessageId: "msg_assistant",
    chatSessionId: "session_1",
    finalEvidenceStatus: "no_evidence",
    primaryKnowledgeBundleId: knowledgeBundleId,
    question: "What is the official missing procedure?",
    reason: "no_matching_evidence",
    retrievalQuery: "official missing procedure",
    route: "okf_only",
    searchedSources: ["okf_retrieval", "rag_retrieval"],
    searchedKnowledgeBundleIds: [knowledgeBundleId],
    workspaceId: "wrk_1",
  }]);
});

test("appendUserMessageAndAssistantReply preserves an existing title while touching updatedAt", async () => {
  const calls: string[] = [];
  const repository = createPostgresChatRepository({
    chatSession: {
      findFirst: async () => ({
        createdAt: new Date(),
        id: "session_1",
        knowledgeBundleId,
        title: "Ground leveling",
        updatedAt: new Date(),
        userId: "usr_1",
        workspaceId: "wrk_1",
      }),
    },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        chatMessage: {
          create: async ({ data }: { data: Record<string, unknown> }) => ({
            citations: data.citations ?? [],
            content: data.content,
            createdAt: new Date(),
            id: `msg_${data.role}`,
            role: data.role,
            sessionId: data.sessionId,
            trace: data.trace ?? null,
          }),
        },
        chatSession: {
          updateMany: async () => {
            calls.push("session.updateMany");
            return { count: 0 };
          },
          update: async () => {
            calls.push("session.update");
          },
        },
        knowledgeGap: { create: async () => undefined },
      }),
  });

  await repository.appendUserMessageAndAssistantReply({
    assistantContent: "Answer",
    assistantTrace: buildStage6aRouterTrace(routeChatQuestion("Follow-up")),
    citations: [],
    content: "Follow-up",
    context,
    knowledgeBundleIds: [knowledgeBundleId],
    primaryKnowledgeBundleId: knowledgeBundleId,
    scopeVersion: 1,
    sessionId: "session_1",
  });

  assert.deepEqual(calls, ["session.updateMany", "session.update"]);
});

test("appendUserMessageAndAssistantReply rejects before writing when the session belongs to another workspace", async () => {
  const calls: string[] = [];
  const repository = createPostgresChatRepository({
    chatSession: {
      findFirst: async () => null,
    },
    $transaction: async () => {
      calls.push("transaction.started");
    },
  });

  await assert.rejects(
    () =>
      repository.appendUserMessageAndAssistantReply({
        assistantContent: "This looks like an approved-knowledge question.",
        assistantTrace: buildStage6aRouterTrace(
          routeChatQuestion("What is the official manual path for GEN OFF BUS?"),
        ),
        citations: [],
        content: "Hello",
        context,
        knowledgeBundleIds: [knowledgeBundleId],
        primaryKnowledgeBundleId: knowledgeBundleId,
        scopeVersion: 1,
        sessionId: "session_other_workspace",
      }),
    /chat_session_not_found/,
  );
  assert.deepEqual(calls, []);
});

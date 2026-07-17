import assert from "node:assert/strict";
import test from "node:test";

import { buildStage6aRouterTrace, routeChatQuestion } from "./chat-router.ts";
import { createPostgresChatRepository } from "./production-chat-repository.ts";

const context = { role: "admin" as const, userId: "usr_1", workspaceId: "wrk_1" };
const knowledgeBundleId = "kb_general";

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
    { knowledgeBundleId, title: "New chat", userId: "usr_1", workspaceId: "wrk_1" },
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

test("appendUserMessageAndAssistantReply inserts one user and one assistant message with trace and touches session.updatedAt", async () => {
  const calls: string[] = [];
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
          update: async () => {
            calls.push("session.update");
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
    sessionId: "session_1",
  });

  assert.deepEqual(calls, [
    "message.create:user",
    "message.create:assistant",
    "session.update",
  ]);
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
        sessionId: "session_other_workspace",
      }),
    /chat_session_not_found/,
  );
  assert.deepEqual(calls, []);
});

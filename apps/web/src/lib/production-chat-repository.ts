import type { Prisma } from "@prisma/client";

import type { AuthWorkspaceContext } from "./auth-workspace.ts";
import type { ChatCitation, ChatMessage, ChatSession } from "./chat-types.ts";
import { getPrisma } from "./prisma.ts";
import type { Stage6aRouterTrace } from "./chat-router.ts";

export type ProductionChatRepository = ReturnType<typeof createPostgresChatRepository>;

type PrismaLike = ReturnType<typeof getPrisma>;

type DbChatSessionRecord = {
  createdAt: Date;
  id: string;
  knowledgeBundleId?: string;
  title: string;
  updatedAt: Date;
  userId: string;
  workspaceId: string;
};

type DbChatMessageRecord = {
  citations: unknown;
  content: string;
  createdAt: Date;
  id: string;
  role: string;
  sessionId: string;
  trace: unknown;
};

export function createPostgresChatRepository(prisma: PrismaLike = getPrisma()) {
  const db = prisma;

  async function getSessionForWorkspace(sessionId: string, workspaceId: string) {
    const record = await db.chatSession.findFirst({
      where: { id: sessionId, workspaceId },
    });

    if (!record) {
      throw new Error("chat_session_not_found");
    }

    return record;
  }

  return {
    async getSessionWorkspaceId(sessionId: string): Promise<string | undefined> {
      const record = await db.chatSession.findUnique({
        select: { workspaceId: true },
        where: { id: sessionId },
      });

      return record?.workspaceId;
    },

    async createSession(input: {
      context: AuthWorkspaceContext;
      knowledgeBundleId?: string;
      title?: string;
    }): Promise<ChatSession> {
      if (!input.knowledgeBundleId) {
        throw new Error("chat_bundle_required");
      }

      const record = await db.chatSession.create({
        data: {
          knowledgeBundleId: input.knowledgeBundleId,
          title: input.title?.trim() || "New chat",
          userId: input.context.userId,
          workspaceId: input.context.workspaceId,
        },
      });

      return mapChatSession(record);
    },

    async getSessions(context: AuthWorkspaceContext): Promise<ChatSession[]> {
      const records = await db.chatSession.findMany({
        orderBy: { updatedAt: "desc" },
        where: { workspaceId: context.workspaceId },
      });

      return records.map(mapChatSession);
    },

    async getSessionWithMessages(input: {
      context: AuthWorkspaceContext;
      sessionId: string;
    }): Promise<{ messages: ChatMessage[]; session: ChatSession }> {
      const sessionRecord = await getSessionForWorkspace(
        input.sessionId,
        input.context.workspaceId,
      );
      const messageRecords = await db.chatMessage.findMany({
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        where: {
          sessionId: input.sessionId,
          workspaceId: input.context.workspaceId,
        },
      });

      return {
        messages: messageRecords.map(mapChatMessage),
        session: mapChatSession(sessionRecord),
      };
    },

    async appendUserMessageAndAssistantReply(input: {
      assistantContent: string;
      assistantTrace: Stage6aRouterTrace;
      citations: ChatCitation[];
      content: string;
      context: AuthWorkspaceContext;
      sessionId: string;
    }): Promise<{ assistantMessage: ChatMessage; userMessage: ChatMessage }> {
      await getSessionForWorkspace(input.sessionId, input.context.workspaceId);

      const [userRecord, assistantRecord] = await db.$transaction(
        async (tx: Prisma.TransactionClient) => {
          const userRecord = await tx.chatMessage.create({
            data: {
              content: input.content,
              role: "user",
              sessionId: input.sessionId,
              workspaceId: input.context.workspaceId,
            },
          });
          const assistantRecord = await tx.chatMessage.create({
            data: {
              citations: input.citations,
              content: input.assistantContent,
              role: "assistant",
              sessionId: input.sessionId,
              trace: input.assistantTrace,
              workspaceId: input.context.workspaceId,
            },
          });
          await tx.chatSession.update({
            data: { updatedAt: new Date() },
            where: { id: input.sessionId },
          });

          return [userRecord, assistantRecord];
        },
      );

      return {
        assistantMessage: mapChatMessage(assistantRecord),
        userMessage: mapChatMessage(userRecord),
      };
    },
  };
}

function mapChatSession(record: DbChatSessionRecord): ChatSession {
  return {
    createdAt: record.createdAt.toISOString(),
    id: record.id,
    knowledgeBundleId: record.knowledgeBundleId ?? "kb_general_local",
    title: record.title,
    updatedAt: record.updatedAt.toISOString(),
    userId: record.userId,
    workspaceId: record.workspaceId,
  };
}

function mapChatMessage(record: DbChatMessageRecord): ChatMessage {
  return {
    citations: normalizeCitations(record.citations),
    content: record.content,
    createdAt: record.createdAt.toISOString(),
    id: record.id,
    role: record.role === "assistant" ? "assistant" : "user",
    sessionId: record.sessionId,
    trace: normalizeTrace(record.trace),
  };
}

function normalizeCitations(value: unknown): ChatCitation[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isChatCitation);
}

function isChatCitation(value: unknown): value is ChatCitation {
  return (
    typeof value === "object" &&
    value !== null &&
    "index" in value &&
    "documentTitle" in value
  );
}

function normalizeTrace(value: unknown): Stage6aRouterTrace | null {
  if (!isStage6aRouterTrace(value)) {
    return null;
  }

  return value;
}

function isStage6aRouterTrace(value: unknown): value is Stage6aRouterTrace {
  return (
    typeof value === "object" &&
    value !== null &&
    "stage" in value &&
    value.stage === "router" &&
    "route" in value &&
    typeof value.route === "string" &&
    "queryCategory" in value &&
    typeof value.queryCategory === "string" &&
    "confidence" in value &&
    typeof value.confidence === "string" &&
    "rationale" in value &&
    typeof value.rationale === "string" &&
    "requiredContext" in value &&
    Array.isArray(value.requiredContext) &&
    "constraints" in value &&
    typeof value.constraints === "object" &&
    value.constraints !== null &&
    "retrievalToolsCalled" in value &&
    Array.isArray(value.retrievalToolsCalled)
  );
}

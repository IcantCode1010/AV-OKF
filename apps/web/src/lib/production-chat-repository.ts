import type { Prisma } from "@prisma/client";

import type { AuthWorkspaceContext } from "./auth-workspace.ts";
import type { ChatCitation, ChatMessage, ChatSession } from "./chat-types.ts";
import { getPrisma } from "./prisma.ts";

export const STUB_ASSISTANT_REPLY_TEXT =
  "Chat routing isn't implemented yet - this is a placeholder reply. " +
  "Your message has been saved, but no document search, OKF lookup, or retrieval has run against it.";

export type ProductionChatRepository = ReturnType<typeof createPostgresChatRepository>;

type PrismaLike = ReturnType<typeof getPrisma>;

type DbChatSessionRecord = {
  createdAt: Date;
  id: string;
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
      title?: string;
    }): Promise<ChatSession> {
      const record = await db.chatSession.create({
        data: {
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

    async appendUserMessageAndStubReply(input: {
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
              content: STUB_ASSISTANT_REPLY_TEXT,
              role: "assistant",
              sessionId: input.sessionId,
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
    trace: record.trace ?? null,
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

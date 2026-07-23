import type { Prisma } from "@prisma/client";

import type { AuthWorkspaceContext } from "./auth-workspace.ts";
import type { ChatCitation, ChatMessage, ChatSession } from "./chat-types.ts";
import type { Stage6aRouterTrace } from "./chat-router.ts";
import type { KnowledgeGapDraft } from "./knowledge-gaps.ts";
import { normalizeOkfCitationExcerpt } from "./okf-article-content.ts";
import { getPrisma } from "./prisma.ts";

export type ProductionChatRepository = ReturnType<typeof createPostgresChatRepository>;

type PrismaLike = ReturnType<typeof getPrisma>;

type DbChatSessionRecord = {
  createdAt: Date;
  id: string;
  knowledgeBundles?: Array<{
    knowledgeBundle: { id: string; name: string };
    position: number;
  }>;
  knowledgeBundleId?: string;
  primaryKnowledgeBundleId?: string | null;
  scopeVersion?: number;
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
  knowledgeBundleIds?: string[];
  role: string;
  scopeVersion?: number;
  sessionId: string;
  trace: unknown;
};

const DEFAULT_CHAT_TITLE = "New chat";
const MAX_CHAT_TITLE_LENGTH = 72;
export const MAX_CHAT_KNOWLEDGE_BUNDLES = 10;

const sessionBundleInclude = {
  knowledgeBundles: {
    include: { knowledgeBundle: { select: { id: true, name: true } } },
    orderBy: { position: "asc" as const },
    where: { knowledgeBundle: { status: "active" } },
  },
};

export function deriveChatSessionTitle(content: string) {
  const normalized = content.normalize("NFKC").replace(/\s+/g, " ").trim();

  if (!normalized) {
    return DEFAULT_CHAT_TITLE;
  }

  if (normalized.length <= MAX_CHAT_TITLE_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_CHAT_TITLE_LENGTH - 3).trimEnd()}...`;
}

export function createPostgresChatRepository(prisma: PrismaLike = getPrisma()) {
  const db = prisma;

  async function getSessionForWorkspace(sessionId: string, workspaceId: string) {
    const record = await db.chatSession.findFirst({
      include: sessionBundleInclude,
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
          knowledgeBundles: {
            create: {
              knowledgeBundleId: input.knowledgeBundleId,
              position: 0,
              selectedBy: input.context.userId,
            },
          },
          primaryKnowledgeBundleId: input.knowledgeBundleId,
          title: input.title?.trim() || DEFAULT_CHAT_TITLE,
          userId: input.context.userId,
          workspaceId: input.context.workspaceId,
        },
        include: sessionBundleInclude,
      });

      return mapChatSession(record);
    },

    async getSessions(context: AuthWorkspaceContext): Promise<ChatSession[]> {
      const records = await db.chatSession.findMany({
        include: sessionBundleInclude,
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

    async updateKnowledgeBundleScope(input: {
      context: AuthWorkspaceContext;
      knowledgeBundleIds: string[];
      sessionId: string;
    }): Promise<ChatSession> {
      const ids = [...new Set(input.knowledgeBundleIds)];
      if (
        ids.length !== input.knowledgeBundleIds.length ||
        ids.length < 1 ||
        ids.length > MAX_CHAT_KNOWLEDGE_BUNDLES
      ) {
        throw new Error("chat_bundle_scope_invalid");
      }

      await getSessionForWorkspace(input.sessionId, input.context.workspaceId);
      const bundles = await db.knowledgeBundle.findMany({
        select: { id: true },
        where: {
          id: { in: ids },
          status: "active",
          workspaceId: input.context.workspaceId,
        },
      });
      if (bundles.length !== ids.length) {
        throw new Error("chat_bundle_scope_invalid");
      }

      await db.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.chatSessionKnowledgeBundle.deleteMany({
          where: { sessionId: input.sessionId },
        });
        await tx.chatSessionKnowledgeBundle.createMany({
          data: ids.map((knowledgeBundleId, position) => ({
            knowledgeBundleId,
            position,
            selectedBy: input.context.userId,
            sessionId: input.sessionId,
          })),
        });
        await tx.chatSession.update({
          data: {
            primaryKnowledgeBundleId: ids[0],
            scopeVersion: { increment: 1 },
          },
          where: { id: input.sessionId },
        });
      });

      return mapChatSession(
        await getSessionForWorkspace(input.sessionId, input.context.workspaceId),
      );
    },

    async appendUserMessageAndAssistantReply(input: {
      assistantContent: string;
      assistantTrace: Stage6aRouterTrace;
      citations: ChatCitation[];
      content: string;
      context: AuthWorkspaceContext;
      knowledgeBundleIds: string[];
      knowledgeGap?: KnowledgeGapDraft;
      primaryKnowledgeBundleId: string | null;
      scopeVersion: number;
      sessionId: string;
    }): Promise<{ assistantMessage: ChatMessage; userMessage: ChatMessage }> {
      await getSessionForWorkspace(
        input.sessionId,
        input.context.workspaceId,
      );

      const [userRecord, assistantRecord] = await db.$transaction(
        async (tx: Prisma.TransactionClient) => {
          const userRecord = await tx.chatMessage.create({
            data: {
              content: input.content,
              knowledgeBundleIds: input.knowledgeBundleIds,
              role: "user",
              scopeVersion: input.scopeVersion,
              sessionId: input.sessionId,
              workspaceId: input.context.workspaceId,
            },
          });
          const assistantRecord = await tx.chatMessage.create({
            data: {
              citations: input.citations,
              content: input.assistantContent,
              knowledgeBundleIds: input.knowledgeBundleIds,
              role: "assistant",
              scopeVersion: input.scopeVersion,
              sessionId: input.sessionId,
              trace: input.assistantTrace as unknown as Prisma.InputJsonValue,
              workspaceId: input.context.workspaceId,
            },
          });
          if (input.knowledgeGap) {
            await tx.knowledgeGap.create({
              data: {
                assistantMessageId: assistantRecord.id,
                chatSessionId: input.sessionId,
                finalEvidenceStatus: input.knowledgeGap.finalEvidenceStatus,
                primaryKnowledgeBundleId: input.primaryKnowledgeBundleId,
                question: input.knowledgeGap.question,
                reason: input.knowledgeGap.reason,
                retrievalQuery: input.knowledgeGap.retrievalQuery,
                route: input.knowledgeGap.route,
                searchedSources: input.knowledgeGap.searchedSources,
                searchedKnowledgeBundleIds: input.knowledgeBundleIds,
                workspaceId: input.context.workspaceId,
              },
            });
          }
          const updatedAt = new Date();
          const titleUpdate = await tx.chatSession.updateMany({
            data: {
              title: deriveChatSessionTitle(input.content),
              updatedAt,
            },
            where: {
              id: input.sessionId,
              title: DEFAULT_CHAT_TITLE,
              workspaceId: input.context.workspaceId,
            },
          });
          if (titleUpdate.count === 0) {
            await tx.chatSession.update({
              data: { updatedAt },
              where: { id: input.sessionId },
            });
          }

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
  const knowledgeBundles = [...(record.knowledgeBundles ?? [])]
    .sort((left, right) => left.position - right.position)
    .map((selection) => ({
      id: selection.knowledgeBundle.id,
      name: selection.knowledgeBundle.name,
      position: selection.position,
    }));

  return {
    createdAt: record.createdAt.toISOString(),
    id: record.id,
    knowledgeBundles,
    primaryKnowledgeBundleId:
      record.primaryKnowledgeBundleId ??
      record.knowledgeBundleId ??
      knowledgeBundles[0]?.id ??
      null,
    scopeVersion: record.scopeVersion ?? 1,
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
    knowledgeBundleIds: record.knowledgeBundleIds ?? [],
    role: record.role === "assistant" ? "assistant" : "user",
    scopeVersion: record.scopeVersion ?? 1,
    sessionId: record.sessionId,
    trace: normalizeTrace(record.trace),
  };
}

function normalizeCitations(value: unknown): ChatCitation[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isChatCitation).map((citation) =>
    citation.sourceType === "okf" &&
    typeof citation.text === "string" &&
    typeof citation.documentTitle === "string"
      ? {
          ...citation,
          text: normalizeOkfCitationExcerpt({
            text: citation.text,
            title: citation.documentTitle,
          }),
        }
      : citation,
  );
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

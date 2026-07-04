import { requireAuthWorkspaceContext } from "./auth-workspace.ts";
import type { AuthWorkspaceContext } from "./auth-workspace.ts";
import {
  buildStage6aRouterReply,
  buildStage6aRouterTrace,
  isRetrievalRoute,
  routeChatQuestion,
} from "./chat-router.ts";
import { buildRetrievalAnswer, runChatRetrieval, type ChatRetrievalFn } from "./chat-retrieval.ts";
import type { ChatMessage, ChatSession } from "./chat-types.ts";
import {
  createPostgresChatRepository,
  type ProductionChatRepository,
} from "./production-chat-repository.ts";

export type ProductionChatService = {
  createSession(title?: string): Promise<ChatSession>;
  getSessionWorkspaceId(sessionId: string): Promise<string | undefined>;
  getSessions(): Promise<ChatSession[]>;
  getSessionWithMessages(
    sessionId: string,
  ): Promise<{ messages: ChatMessage[]; session: ChatSession } | undefined>;
  sendMessage(
    sessionId: string,
    content: string,
  ): Promise<{ assistantMessage: ChatMessage; userMessage: ChatMessage }>;
};

let cachedService: ProductionChatService | null = null;

type ProductionChatServiceOptions = {
  getContext?: () => Promise<AuthWorkspaceContext>;
  retrieve?: ChatRetrievalFn;
};

export function getProductionChatService(): ProductionChatService {
  if (!cachedService) {
    cachedService = createProductionChatService();
  }

  return cachedService;
}

export function createProductionChatService(
  repository: ProductionChatRepository = createPostgresChatRepository(),
  options: ProductionChatServiceOptions = {},
): ProductionChatService {
  async function getContext(): Promise<AuthWorkspaceContext> {
    return options.getContext ? options.getContext() : requireAuthWorkspaceContext();
  }

  const retrieve = options.retrieve ?? runChatRetrieval;

  return {
    async createSession(title?: string) {
      const context = await getContext();
      return repository.createSession({ context, title });
    },

    async getSessionWorkspaceId(sessionId: string) {
      return repository.getSessionWorkspaceId(sessionId);
    },

    async getSessions() {
      const context = await getContext();
      return repository.getSessions(context);
    },

    async getSessionWithMessages(sessionId: string) {
      const context = await getContext();

      try {
        return await repository.getSessionWithMessages({ context, sessionId });
      } catch (error) {
        if (error instanceof Error && error.message === "chat_session_not_found") {
          return undefined;
        }

        throw error;
      }
    },

    async sendMessage(sessionId: string, content: string) {
      const context = await getContext();
      const decision = routeChatQuestion(content);
      const retrieval = isRetrievalRoute(decision.route)
        ? await retrieve({ decision, query: content, workspaceId: context.workspaceId })
        : { citations: [], retrievalError: false, retrievalToolsCalled: [], sourcesRead: [] };
      const assistantContent = isRetrievalRoute(decision.route)
        ? buildRetrievalAnswer(decision.route, retrieval)
        : buildStage6aRouterReply(decision);

      return repository.appendUserMessageAndAssistantReply({
        assistantContent,
        assistantTrace: {
          ...buildStage6aRouterTrace(decision),
          retrievalToolsCalled: retrieval.retrievalToolsCalled,
          sourcesRead: retrieval.sourcesRead,
        },
        citations: retrieval.citations,
        content,
        context,
        sessionId,
      });
    },
  };
}

import { requireAuthWorkspaceContext } from "./auth-workspace.ts";
import type { AuthWorkspaceContext } from "./auth-workspace.ts";
import { generateChatAnswer, type ChatAnswer } from "./chat-answer.ts";
import { buildAnswerEvidenceProfile } from "./chat-evidence-profile.ts";
import { validateChatAnswerEvidence } from "./chat-validation.ts";
import {
  buildStage6aRouterReply,
  buildStage6aRouterTrace,
  isRetrievalRoute,
  routeChatQuestionWithFallback,
} from "./chat-router.ts";
import type { ChatRouterDecision, ChatRouterInput } from "./chat-router.ts";
import {
  buildRetrievalAnswer,
  resolveEvidenceStatus,
  runChatRetrieval,
  type ChatRetrievalFn,
} from "./chat-retrieval.ts";
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

// How many prior messages ride along as router conversation context;
// query-router.md says this "can be minimal" for MVP.
const CONVERSATION_CONTEXT_TURNS = 6;

let cachedService: ProductionChatService | null = null;

type ProductionChatServiceOptions = {
  generateAnswer?: typeof generateChatAnswer;
  getContext?: () => Promise<AuthWorkspaceContext>;
  retrieve?: ChatRetrievalFn;
  routeQuestion?: (input: ChatRouterInput) => Promise<ChatRouterDecision>;
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
  const generateAnswer = options.generateAnswer ?? generateChatAnswer;
  const routeQuestion = options.routeQuestion ?? routeChatQuestionWithFallback;

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
      // Recent turns give the router (and its future LLM-fallback/agent
      // implementation) the conversation_context input from query-router.md.
      const history = await repository.getSessionWithMessages({
        context,
        sessionId,
      });
      const conversationContext = history.messages
        .slice(-CONVERSATION_CONTEXT_TURNS)
        .map((message) => `${message.role}: ${message.content}`);
      const decision = await routeQuestion({
        conversationContext,
        question: content,
        workspaceId: context.workspaceId,
      });
      const retrieval = isRetrievalRoute(decision.route)
        ? await retrieve({ decision, query: content, workspaceId: context.workspaceId })
        : {
            approvedOkfAvailable: false,
            citations: [],
            evidence: [],
            ragUsedForDiscoveryOnly: false,
            retrievalError: false,
            retrievalToolsCalled: [],
            sourcesRead: [],
          };
      const answer: ChatAnswer = isRetrievalRoute(decision.route)
        ? await generateAnswer({
            evidence: retrieval.evidence,
            query: content,
            retrieval,
            route: decision.route,
            workspaceId: context.workspaceId,
          })
        : { content: buildStage6aRouterReply(decision), mode: "deterministic" };
      const assistantTrace = {
        ...buildStage6aRouterTrace(decision),
        answerMode: answer.mode,
        ...(answer.model ? { answerModel: answer.model } : {}),
        ...(answer.provider ? { answerProvider: answer.provider } : {}),
        ...(isRetrievalRoute(decision.route)
          ? {
              approvedOkfAvailable: retrieval.approvedOkfAvailable,
              finalEvidenceStatus: resolveEvidenceStatus(retrieval),
              ragUsedForDiscoveryOnly: retrieval.ragUsedForDiscoveryOnly,
            }
          : {}),
        retrievalToolsCalled: retrieval.retrievalToolsCalled,
        sourcesRead: retrieval.sourcesRead,
      };
      const answerValidation = validateChatAnswerEvidence({
        answerContent: answer.content,
        citations: retrieval.citations,
        retrievalError: retrieval.retrievalError,
        route: decision.route,
        trace: assistantTrace,
      });
      const safeAnswer =
        answerValidation.status === "fail" && isRetrievalRoute(decision.route)
          ? {
              ...answer,
              content: buildRetrievalAnswer(decision.route, retrieval),
              mode: "deterministic" as const,
            }
          : answer;

      return repository.appendUserMessageAndAssistantReply({
        assistantContent: safeAnswer.content,
        assistantTrace: {
          ...assistantTrace,
          answerMode: safeAnswer.mode,
          answerEvidenceProfile: buildAnswerEvidenceProfile({
            citations: retrieval.citations,
            trace: assistantTrace,
          }),
          answerValidation,
        },
        citations: retrieval.citations,
        content,
        context,
        sessionId,
      });
    },
  };
}

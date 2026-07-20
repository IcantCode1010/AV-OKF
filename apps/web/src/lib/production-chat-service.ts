import { requireAuthWorkspaceContext } from "./auth-workspace.ts";
import type { AuthWorkspaceContext } from "./auth-workspace.ts";
import {
  discloseChatAssumptions,
  generateChatAnswer,
  type ChatAnswer,
} from "./chat-answer.ts";
import { buildAnswerEvidenceProfile } from "./chat-evidence-profile.ts";
import { validateChatAnswerEvidence } from "./chat-validation.ts";
import {
  buildSkippedQueryUnderstanding,
  buildUnresolvedVagueQueryUnderstanding,
  isUnresolvedVagueQuestion,
  shouldRunQueryUnderstanding,
  understandChatQuery,
  type ChatQueryUnderstandingFn,
} from "./chat-query-understanding.ts";
import {
  buildStage6aRouterReply,
  buildStage6aRouterTrace,
  isRetrievalRoute,
  routeChatQuestionWithFallback,
} from "./chat-router.ts";
import type { ChatRouterDecision, ChatRouterInput } from "./chat-router.ts";
import type { MetadataClarificationSelection } from "./chat-router.ts";
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
  createSession(knowledgeBundleId: string, title?: string): Promise<ChatSession>;
  getSessionWorkspaceId(sessionId: string): Promise<string | undefined>;
  getSessions(): Promise<ChatSession[]>;
  getSessionWithMessages(
    sessionId: string,
  ): Promise<{ messages: ChatMessage[]; session: ChatSession } | undefined>;
  sendMessage(
    sessionId: string,
    content: string,
    metadataSelection?: MetadataClarificationSelection[],
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
  understandQuery?: ChatQueryUnderstandingFn;
  validateAnswer?: typeof validateChatAnswerEvidence;
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
  const understandQuery = options.understandQuery ?? understandChatQuery;
  const validateAnswer = options.validateAnswer ?? validateChatAnswerEvidence;

  return {
    async createSession(knowledgeBundleId: string, title?: string) {
      const context = await getContext();
      return repository.createSession({ context, knowledgeBundleId, title });
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

    async sendMessage(
      sessionId: string,
      content: string,
      metadataSelection?: MetadataClarificationSelection[],
    ) {
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
      const clarification = getClarificationState(history.messages);
      const decision = await routeQuestion({
        clarificationAlreadyAsked: clarification.alreadyAsked,
        conversationContext,
        question: content,
        workspaceId: context.workspaceId,
      });
      const validatedMetadataSelection = validateMetadataClarificationSelection(
        history.messages,
        metadataSelection,
      );
      const unresolvedVagueFollowUp =
        clarification.alreadyAsked &&
        !validatedMetadataSelection &&
        isUnresolvedVagueQuestion(content);
      const queryUnderstanding = unresolvedVagueFollowUp
        ? buildUnresolvedVagueQueryUnderstanding(content)
        : shouldRunQueryUnderstanding({
        clarificationAlreadyAsked: clarification.alreadyAsked,
        clarificationOriginQuestion: clarification.originQuestion,
        decision,
        question: content,
      })
        ? await understandQuery({
            clarificationAlreadyAsked: clarification.alreadyAsked,
            clarificationOriginQuestion: clarification.originQuestion,
            conversationContext,
            decision,
            question: content,
            workspaceId: context.workspaceId,
          })
        : buildSkippedQueryUnderstanding(content);
      const retrievalQuery = queryUnderstanding.retrievalQuery;
      const retrieval = isRetrievalRoute(decision.route) && !unresolvedVagueFollowUp
          ? await retrieve({
            clarificationAlreadyAsked: clarification.alreadyAsked,
            decision,
            knowledgeBundleId: history.session.knowledgeBundleId,
            query: retrievalQuery,
            workspaceId: context.workspaceId,
          })
        : {
            approvedOkfAvailable: false,
            citations: [],
            evidence: [],
            ragUsedForDiscoveryOnly: false,
            retrievalError: false,
            retrievalToolsCalled: [],
            rerank: { applied: false, dropped: 0, status: "not_applicable" as const },
            sourcesRead: [],
          };
      const effectiveQueryUnderstanding = retrieval.metadataClarification
        ? {
            ...queryUnderstanding,
            ambiguityLevel: "high" as const,
            clarifyingQuestion: retrieval.metadataClarification.question,
            warnings: [
              ...queryUnderstanding.warnings,
              "metadata_driven_clarification",
            ],
          }
        : queryUnderstanding;
      const answer: ChatAnswer = retrieval.metadataClarification
        ? {
            content: retrieval.metadataClarification.question,
            mode: "deterministic" as const,
          }
        : unresolvedVagueFollowUp
        ? {
            content: buildUnresolvedVagueFollowUpReply(),
            mode: "deterministic" as const,
          }
        : isRetrievalRoute(decision.route)
        ? await generateAnswer({
            evidence: retrieval.evidence,
            query: retrievalQuery,
            retrieval,
            route: decision.route,
            workspaceId: context.workspaceId,
          })
        : {
            content:
              decision.route === "missing_context" &&
              queryUnderstanding.rewriteMode === "llm" &&
              queryUnderstanding.clarifyingQuestion
                ? queryUnderstanding.clarifyingQuestion
                : buildStage6aRouterReply(decision),
            mode: "deterministic" as const,
          };
      const assistantTrace = {
        ...buildStage6aRouterTrace(decision),
        answerMode: answer.mode,
        ...(answer.model ? { answerModel: answer.model } : {}),
        ...(answer.provider ? { answerProvider: answer.provider } : {}),
        queryUnderstanding: effectiveQueryUnderstanding,
        ...(retrieval.metadataClarification
          ? { metadataClarification: retrieval.metadataClarification }
          : {}),
        ...(validatedMetadataSelection
          ? { metadataClarificationSelection: validatedMetadataSelection }
          : {}),
        ...(isRetrievalRoute(decision.route)
          ? {
              approvedOkfAvailable: retrieval.approvedOkfAvailable,
              finalEvidenceStatus: resolveEvidenceStatus(retrieval),
              ragUsedForDiscoveryOnly: retrieval.ragUsedForDiscoveryOnly,
              ...(retrieval.okfEvidenceMode
                ? { okfEvidenceMode: retrieval.okfEvidenceMode }
                : {}),
              ...(retrieval.okfMatchMode
                ? { okfMatchMode: retrieval.okfMatchMode }
                : {}),
            }
          : {}),
        rerank: retrieval.rerank,
        retrievalToolsCalled: retrieval.retrievalToolsCalled,
        sourcesRead: retrieval.sourcesRead,
      };
      const answerValidation = retrieval.metadataClarification || unresolvedVagueFollowUp
        ? undefined
        : validateAnswer({
            answerContent: answer.content,
            citations: retrieval.citations,
            retrievalError: retrieval.retrievalError,
            route: decision.route,
            trace: assistantTrace,
          });
      const safeAnswer =
        answerValidation?.status === "fail" && isRetrievalRoute(decision.route)
          ? {
              ...answer,
              content: buildRetrievalAnswer(decision.route, retrieval),
              mode: "deterministic" as const,
            }
          : answer;
      const disclosedAnswer = {
        ...safeAnswer,
        content: discloseChatAssumptions(
          safeAnswer.content,
          effectiveQueryUnderstanding.assumptions,
        ),
      };

      return repository.appendUserMessageAndAssistantReply({
        assistantContent: disclosedAnswer.content,
        assistantTrace: {
          ...assistantTrace,
          answerMode: disclosedAnswer.mode,
          answerEvidenceProfile: buildAnswerEvidenceProfile({
            citations: retrieval.citations,
            trace: assistantTrace,
          }),
          ...(answerValidation ? { answerValidation } : {}),
        },
        citations: retrieval.citations,
        content,
        context,
        sessionId,
      });
    },
  };
}

function buildUnresolvedVagueFollowUpReply(): string {
  return [
    "I still cannot identify the subject of the question.",
    "Name the document, topic, policy, product, or other subject you want searched.",
    'For example: "What does [term] mean in [document or topic]?"',
  ].join(" ");
}

export function getClarificationState(messages: ChatMessage[]): {
  alreadyAsked: boolean;
  originQuestion?: string;
} {
  let alreadyAsked = false;

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message?.role !== "assistant" || !isClarificationMessage(message)) {
      continue;
    }

    alreadyAsked = true;
  }

  const latestMessage = messages.at(-1);
  if (
    latestMessage?.role !== "assistant" ||
    !isClarificationMessage(latestMessage)
  ) {
    return { alreadyAsked };
  }

  for (let originIndex = messages.length - 2; originIndex >= 0; originIndex -= 1) {
    const origin = messages[originIndex];
    if (origin?.role === "user") {
      return { alreadyAsked: true, originQuestion: origin.content };
    }
  }

  return { alreadyAsked: true };
}

function isClarificationMessage(message: ChatMessage): boolean {
  return Boolean(
    message.trace?.route === "missing_context" ||
      message.trace?.metadataClarification,
  );
}

export function validateMetadataClarificationSelection(
  messages: ChatMessage[],
  selection?: MetadataClarificationSelection[],
): MetadataClarificationSelection[] | undefined {
  if (!selection || selection.length === 0) return undefined;
  const latest = messages.at(-1);
  const clarification = latest?.role === "assistant"
    ? latest.trace?.metadataClarification
    : undefined;
  if (!clarification) throw new Error("metadata_clarification_not_active");
  if (selection.length !== clarification.fields.length) {
    throw new Error("metadata_clarification_selection_incomplete");
  }
  const selectedByField = new Map(selection.map((entry) => [entry.field, entry]));
  if (selectedByField.size !== selection.length) {
    throw new Error("metadata_clarification_selection_duplicate");
  }
  return clarification.fields.map((field) => {
    const selected = selectedByField.get(field.field);
    if (
      !selected ||
      selected.label !== field.label ||
      !field.options.includes(selected.value)
    ) {
      throw new Error("metadata_clarification_selection_invalid");
    }
    return selected;
  });
}

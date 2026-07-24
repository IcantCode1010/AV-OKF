import { requireAuthWorkspaceContext } from "./auth-workspace.ts";
import type { AuthWorkspaceContext } from "./auth-workspace.ts";
import {
  buildNotDirectlyAnsweredReply,
  discloseChatAssumptions,
  generateChatAnswer,
  type ChatAnswer,
} from "./chat-answer.ts";
import { buildAnswerEvidenceProfile } from "./chat-evidence-profile.ts";
import {
  createBoundedAdaptiveRetryQuery,
  type AdaptiveRetryTrace,
} from "./chat-adaptive-retry.ts";
import {
  classifyEvidenceSufficiency,
  resolveRagInvocationReason,
} from "./chat-evidence-sufficiency.ts";
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
  mergeAdaptiveRetrievalResults,
  resolveEvidenceStatus,
  runChatRetrieval,
  type ChatRetrievalFn,
} from "./chat-retrieval.ts";
import type { ChatMessage, ChatSession } from "./chat-types.ts";
import { annotateChatCitationLifecycle } from "./chat-citation-lifecycle.ts";
import type { KnowledgeGapDraft } from "./knowledge-gaps.ts";
import type { AgentExecutionTrace } from "./agent-tools.ts";
import {
  createPostgresChatRepository,
  type ProductionChatRepository,
} from "./production-chat-repository.ts";

export type ProductionChatService = {
  createSession(knowledgeBundleId: string, title?: string): Promise<ChatSession>;
  getSessionWorkspaceId(sessionId: string): Promise<string | undefined>;
  getSessions(): Promise<ChatSession[]>;
  updateSessionKnowledgeBundles(
    sessionId: string,
    knowledgeBundleIds: string[],
  ): Promise<ChatSession>;
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
  annotateCitations?: typeof annotateChatCitationLifecycle;
  createAdaptiveRetryQuery?: typeof createBoundedAdaptiveRetryQuery;
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
  const annotateCitations = options.annotateCitations ?? annotateChatCitationLifecycle;
  const createAdaptiveRetryQuery =
    options.createAdaptiveRetryQuery ?? createBoundedAdaptiveRetryQuery;

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

    async updateSessionKnowledgeBundles(sessionId, knowledgeBundleIds) {
      const context = await getContext();
      return repository.updateKnowledgeBundleScope({
        context,
        knowledgeBundleIds,
        sessionId,
      });
    },

    async getSessionWithMessages(sessionId: string) {
      const context = await getContext();

      try {
        const result = await repository.getSessionWithMessages({ context, sessionId });
        const annotatedCitations = await annotateCitations({
          citations: result.messages.flatMap((message) => message.citations),
          knowledgeBundleId:
            result.session.primaryKnowledgeBundleId ??
            result.session.knowledgeBundles[0]?.id,
          workspaceId: context.workspaceId,
        });
        let citationOffset = 0;
        return {
          ...result,
          messages: result.messages.map((message) => {
            const citations = annotatedCitations.slice(
              citationOffset,
              citationOffset + message.citations.length,
            );
            citationOffset += message.citations.length;
            return { ...message, citations };
          }),
        };
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
      const bundleScope = history.session.knowledgeBundles;
      const knowledgeBundleIds = bundleScope.map((bundle) => bundle.id);
      if (knowledgeBundleIds.length === 0) {
        throw new Error("chat_bundle_scope_required");
      }
      const scopeVersion = history.session.scopeVersion;
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
      let retrieval = isRetrievalRoute(decision.route) && !unresolvedVagueFollowUp
          ? await retrieve({
            clarificationAlreadyAsked: clarification.alreadyAsked,
            decision,
            includeSearchSummary: true,
            knowledgeBundleIds,
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
      let evidenceSufficiency = classifyEvidenceSufficiency(
        retrieval,
        decision,
      );
      const deterministicRetrieval = retrieval;
      let adaptiveRetry: AdaptiveRetryTrace | undefined;
      const enabledRetryBundleIds = bundleScope
        .filter((bundle) => bundle.boundedAdaptiveRetryEnabled === true)
        .map((bundle) => bundle.id);
      if (
        isRetrievalRoute(decision.route) &&
        !unresolvedVagueFollowUp &&
        !retrieval.metadataClarification
      ) {
        const retryPlan = await createAdaptiveRetryQuery({
          decision,
          enabledBundleIds: enabledRetryBundleIds,
          originalQuery: retrievalQuery,
          sufficiency: evidenceSufficiency,
          workspaceId: context.workspaceId,
        });
        adaptiveRetry = retryPlan.trace;
        if (retryPlan.query) {
          const retryResult = await retrieve({
            clarificationAlreadyAsked: true,
            decision,
            includeSearchSummary: true,
            knowledgeBundleIds: enabledRetryBundleIds,
            query: retryPlan.query,
            workspaceId: context.workspaceId,
          });
          const merged = mergeAdaptiveRetrievalResults(
            retrieval,
            retryResult,
            decision,
          );
          if (merged.evidenceDelta.citations > 0) {
            retrieval = merged.result;
            adaptiveRetry = {
              ...adaptiveRetry,
              evidenceDelta: merged.evidenceDelta,
            };
            evidenceSufficiency = classifyEvidenceSufficiency(
              retrieval,
              decision,
            );
          } else {
            adaptiveRetry = {
              ...adaptiveRetry,
              fallbackUsed: true,
              outcome: "no_improvement",
            };
          }
        }
      }
      const ragInvocationReason = resolveRagInvocationReason(
        retrieval,
        decision,
      );
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
            outcome: "answered" as const,
          }
        : unresolvedVagueFollowUp
        ? {
            content: buildUnresolvedVagueFollowUpReply(),
            mode: "deterministic" as const,
            outcome: "answered" as const,
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
            outcome: "answered" as const,
          };
      const assistantTrace = {
        ...buildStage6aRouterTrace(decision),
        answerMode: answer.mode,
        answerOutcome: answer.outcome,
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
              evidenceSufficiency,
              finalEvidenceStatus: resolveEvidenceStatus(retrieval),
              ragInvocationReason,
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
        ...(retrieval.agentExecution
          ? { agentExecution: retrieval.agentExecution }
          : {}),
        bundleScope: {
          bundleIds: knowledgeBundleIds,
          bundleNames: bundleScope.map((bundle) => bundle.name),
          scopeVersion,
        },
        ...(retrieval.crossBundleConflict
          ? { crossBundleConflict: retrieval.crossBundleConflict }
          : {}),
        ...(adaptiveRetry ? { adaptiveRetry } : {}),
        retrievalToolsCalled: retrieval.retrievalToolsCalled,
        ...(retrieval.searchSummary
          ? { searchSummary: retrieval.searchSummary }
          : {}),
        sourcesRead: retrieval.sourcesRead,
      };
      const answerValidation = retrieval.metadataClarification || unresolvedVagueFollowUp
        ? undefined
        : validateAnswer({
            answerOutcome: answer.outcome,
            answerContent: answer.content,
            citations: retrieval.citations,
            retrievalError: retrieval.retrievalError,
            route: decision.route,
            trace: assistantTrace,
          });
      const agentExecution = isRetrievalRoute(decision.route)
        ? appendValidationToolTrace(
            retrieval.agentExecution,
            knowledgeBundleIds,
            answerValidation,
          )
        : retrieval.agentExecution;
      const persistedRetrieval =
        answerValidation?.status === "fail" &&
        adaptiveRetry?.outcome === "applied"
          ? deterministicRetrieval
          : retrieval;
      const safeAnswer =
        answerValidation?.status === "fail" && isRetrievalRoute(decision.route)
          ? {
              ...answer,
              content: answer.outcome === "insufficient_evidence"
                ? buildNotDirectlyAnsweredReply(decision.route)
                : buildRetrievalAnswer(decision.route, persistedRetrieval),
              mode: "deterministic" as const,
            }
          : answer;
      const finalAdaptiveRetry = adaptiveRetry
        ? {
            ...adaptiveRetry,
            ...(answerValidation
              ? { validationStatus: answerValidation.status }
              : {}),
            ...(answerValidation?.status === "fail" &&
            adaptiveRetry.outcome === "applied"
              ? {
                  fallbackUsed: true,
                  outcome: "validation_failed" as const,
                }
              : {}),
          }
        : undefined;
      const persistedEvidenceSufficiency = classifyEvidenceSufficiency(
        persistedRetrieval,
        decision,
      );
      const {
        crossBundleConflict: _discardedCrossBundleConflict,
        ...traceWithoutCrossBundleConflict
      } = assistantTrace;
      void _discardedCrossBundleConflict;
      const persistedAssistantTrace = {
        ...traceWithoutCrossBundleConflict,
        approvedOkfAvailable: persistedRetrieval.approvedOkfAvailable,
        evidenceSufficiency: persistedEvidenceSufficiency,
        finalEvidenceStatus: resolveEvidenceStatus(persistedRetrieval),
        ragInvocationReason: resolveRagInvocationReason(
          persistedRetrieval,
          decision,
        ),
        ragUsedForDiscoveryOnly:
          persistedRetrieval.ragUsedForDiscoveryOnly,
        rerank: persistedRetrieval.rerank,
        retrievalToolsCalled: persistedRetrieval.retrievalToolsCalled,
        sourcesRead: persistedRetrieval.sourcesRead,
        ...(persistedRetrieval.crossBundleConflict
          ? { crossBundleConflict: persistedRetrieval.crossBundleConflict }
          : {}),
      };
      const disclosedAnswer = {
        ...safeAnswer,
        content: discloseChatAssumptions(
          safeAnswer.content,
          effectiveQueryUnderstanding.assumptions,
        ),
      };
      const knowledgeGap: KnowledgeGapDraft | undefined =
        disclosedAnswer.outcome === "insufficient_evidence" &&
        isRetrievalRoute(decision.route)
          ? {
              finalEvidenceStatus: resolveEvidenceStatus(persistedRetrieval),
              question: content,
              reason: persistedRetrieval.citations.length === 0
                ? "no_matching_evidence"
                : "related_evidence_not_answering",
              retrievalQuery,
              route: decision.route,
              searchedSources: Array.from(new Set([
                ...persistedRetrieval.retrievalToolsCalled,
                ...persistedRetrieval.sourcesRead,
              ])),
            }
          : undefined;

      return repository.appendUserMessageAndAssistantReply({
        assistantContent: disclosedAnswer.content,
        assistantTrace: {
          ...persistedAssistantTrace,
          ...(finalAdaptiveRetry ? { adaptiveRetry: finalAdaptiveRetry } : {}),
          ...(agentExecution ? { agentExecution } : {}),
          answerMode: disclosedAnswer.mode,
          answerOutcome: disclosedAnswer.outcome,
          answerEvidenceProfile: buildAnswerEvidenceProfile({
            citations: persistedRetrieval.citations,
            trace: persistedAssistantTrace,
          }),
          ...(answerValidation ? { answerValidation } : {}),
        },
        citations: persistedRetrieval.citations,
        content,
        context,
        knowledgeBundleIds,
        ...(knowledgeGap ? { knowledgeGap } : {}),
        primaryKnowledgeBundleId:
          history.session.primaryKnowledgeBundleId ?? knowledgeBundleIds[0] ?? null,
        scopeVersion,
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

function appendValidationToolTrace(
  trace: AgentExecutionTrace | undefined,
  bundleIds: string[],
  validation: ReturnType<typeof validateChatAnswerEvidence> | undefined,
): AgentExecutionTrace {
  const base = trace ?? {
    callLimit: 8,
    calls: [],
    mode: "deterministic" as const,
  };
  if (!validation) return base;
  return {
    ...base,
    calls: [
      ...base.calls,
      {
        bundleIds,
        input: { safeAnswerMode: validation.safeAnswerMode },
        resultCount: validation.status === "pass" ? 1 : 0,
        sequence: base.calls.length + 1,
        status: "succeeded",
        tool: "validateAnswerEvidence",
        warningCodes: validation.violations,
      },
    ],
  };
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

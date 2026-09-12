import {knowledgeFeature} from "./knowledge/contracts.ts";
import { buildChatAnswerConnections } from "./chat-answer-graph.ts";
import {researchChatEvidence} from "./knowledge/chat-research.ts";
import {conversationalReply} from "./knowledge/conversation.ts";
import {validateResearchEvidence, validateResearchGraphConnections} from "./knowledge/research.ts";
import {getPrisma} from "./prisma.ts";
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
import { finalizeChatTurn } from "./chat-turn-finalization.ts";
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
      const session=await repository.createSession({ context, knowledgeBundleId, title });
      if(!knowledgeFeature("shared"))return session;
      const bundles=await getPrisma().knowledgeBundle.findMany({where:{workspaceId:context.workspaceId,status:"active"},select:{id:true}});
      return repository.updateKnowledgeBundleScope({context,sessionId:session.id,knowledgeBundleIds:bundles.map(b=>b.id)});
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
      if(knowledgeFeature("shared"))await getPrisma().knowledgeResearchRun.updateMany({where:{workspaceId:context.workspaceId,userId:context.userId,ownerId:sessionId,status:"running"},data:{cancelledAt:new Date()}});
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
        const projectedMessages = result.messages.map(projectMessageEvidenceForDisplay);
        const annotatedCitations = await annotateCitations({
          citations: projectedMessages.flatMap((message) => [
            ...message.citations,
            ...(message.trace?.relatedEvidence ?? []).map(({ rank, ...citation }) => ({
              ...citation,
              index: rank,
            })),
          ]),
          knowledgeBundleId:
            result.session.primaryKnowledgeBundleId ??
            result.session.knowledgeBundles[0]?.id,
          workspaceId: context.workspaceId,
        });
        let citationOffset = 0;
        return {
          ...result,
          messages: projectedMessages.map((message) => {
            const activeCount = message.citations.length;
            const relatedCount = message.trace?.relatedEvidence?.length ?? 0;
            const citations = annotatedCitations.slice(
              citationOffset,
              citationOffset + activeCount,
            );
            const relatedEvidence = annotatedCitations
              .slice(
                citationOffset + activeCount,
                citationOffset + activeCount + relatedCount,
              )
              .map(({ index, ...citation }) => ({
                ...citation,
                rank: index,
                reason: message.trace?.relatedEvidence?.find(
                  (item) => item.rank === index,
                )?.reason ?? "retrieved_not_cited" as const,
              }));
            citationOffset += activeCount + relatedCount;
            return {
              ...message,
              citations,
              trace: message.trace
                ? { ...message.trace, relatedEvidence }
                : message.trace,
            };
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
      const smallTalk=knowledgeFeature("chat")?conversationalReply(content):null;
      if(smallTalk){const ids=history.session.knowledgeBundles.map(b=>b.id);return repository.appendUserMessageAndAssistantReply({context,sessionId,content,assistantContent:smallTalk,citations:[],knowledgeBundleIds:ids,scopeVersion:history.session.scopeVersion,primaryKnowledgeBundleId:history.session.primaryKnowledgeBundleId,assistantTrace:{...buildStage6aRouterTrace({route:"unsupported",queryCategory:"unsupported",confidence:"high",constraints:{approvedOnly:false,includeUnreviewed:false},requiredContext:[],rationale:"Conversational turn; no source claims or retrieval required."}),responseKind:"conversation",answerMode:"deterministic",answerOutcome:"answered",bundleScope:{bundleIds:ids,bundleNames:history.session.knowledgeBundles.map(b=>b.name),scopeVersion:history.session.scopeVersion}}});}
      const scopedMessages=history.messages.filter(message=>message.scopeVersion===history.session.scopeVersion && message.knowledgeBundleIds.every(id=>history.session.knowledgeBundles.some(b=>b.id===id)));
      const conversationContext = scopedMessages
        .filter(message=>!knowledgeFeature("chat")||message.citations.length===0)
        .slice(-CONVERSATION_CONTEXT_TURNS)
        .map((message) => `${message.role}: ${message.content}`);
      const clarification = getClarificationState(scopedMessages);
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
        scopedMessages,
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
      const useSharedResearch = knowledgeFeature("chat") && !options.retrieve && isRetrievalRoute(decision.route) && (decision.route !== "okf_only" || decision.requiresGraphTraversal === true) && !unresolvedVagueFollowUp;
      let retrieval = !useSharedResearch && isRetrievalRoute(decision.route) && !unresolvedVagueFollowUp
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
      let graphResearch:Awaited<ReturnType<typeof researchChatEvidence>>|undefined;
      if(useSharedResearch){
        graphResearch=await researchChatEvidence(context,sessionId,retrievalQuery,knowledgeBundleIds,retrieval);
        retrieval=graphResearch.result;
      }
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
        !graphResearch &&
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
          const hasQualifiedImprovement =
            merged.evidenceDelta.citations > 0 &&
            (decision.route !== "okf_only" ||
              merged.evidenceDelta.approvedOkf > 0);
          if (hasQualifiedImprovement) {
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
      let answerValidation = retrieval.metadataClarification || unresolvedVagueFollowUp
        ? undefined
        : validateAnswer({
            answerOutcome: answer.outcome,
            answerContent: answer.content,
            citations: retrieval.citations,
            retrievalError: retrieval.retrievalError,
            route: decision.route,
            trace: assistantTrace,
          });
      let persistedRetrieval = retrieval;
      let safeAnswer = answer;
      if (
        answerValidation?.status === "fail" &&
        adaptiveRetry?.outcome === "applied" &&
        isRetrievalRoute(decision.route)
      ) {
        const repairedAnswer = {
          ...answer,
          content: answer.outcome === "insufficient_evidence"
            ? buildNotDirectlyAnsweredReply(decision.route)
            : buildRetrievalAnswer(decision.route, retrieval),
          mode: "deterministic" as const,
        };
        const repairedValidation = validateAnswer({
          answerOutcome: repairedAnswer.outcome,
          answerContent: repairedAnswer.content,
          citations: retrieval.citations,
          retrievalError: retrieval.retrievalError,
          route: decision.route,
          trace: assistantTrace,
        });
        if (repairedValidation.status === "pass") {
          answerValidation = repairedValidation;
          safeAnswer = repairedAnswer;
        } else {
          persistedRetrieval = deterministicRetrieval;
          safeAnswer = {
            ...answer,
            content: answer.outcome === "insufficient_evidence"
              ? buildNotDirectlyAnsweredReply(decision.route)
              : buildRetrievalAnswer(decision.route, deterministicRetrieval),
            mode: "deterministic" as const,
          };
        }
      } else if (
        answerValidation?.status === "fail" &&
        isRetrievalRoute(decision.route)
      ) {
        safeAnswer = {
          ...answer,
          content: answer.outcome === "insufficient_evidence"
            ? buildNotDirectlyAnsweredReply(decision.route)
            : buildRetrievalAnswer(decision.route, retrieval),
          mode: "deterministic" as const,
        };
      }
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
        retrievalSufficiency: persistedEvidenceSufficiency,
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
      const proposedEntityCandidates =
        answerValidation?.status === "pass" &&
        disclosedAnswer.mode === "llm" &&
        disclosedAnswer.outcome === "answered"
          ? disclosedAnswer.entityCandidates
          : undefined;
      let finalAnswer = disclosedAnswer;
      let finalizedTurn = finalizeChatTurn({
        citations: persistedRetrieval.citations,
        content: finalAnswer.content,
        entityCandidates: proposedEntityCandidates,
        outcome: finalAnswer.outcome,
        retrievalError: persistedRetrieval.retrievalError,
      });
      let answerProjectionFallback = answerValidation?.status === "fail"
        ? { reasonCodes: [...answerValidation.violations] }
        : undefined;
      if (!retrieval.metadataClarification && !unresolvedVagueFollowUp) {
        const finalProjectionValidation = validateAnswer({
          answerOutcome: finalAnswer.outcome,
          answerContent: finalizedTurn.content,
          availableCitations: persistedRetrieval.citations,
          citations: finalizedTurn.citations,
          retrievalError: persistedRetrieval.retrievalError,
          route: decision.route,
          trace: persistedAssistantTrace,
        });
        if (
          finalProjectionValidation.status === "fail" &&
          finalAnswer.mode === "llm" &&
          finalAnswer.outcome === "answered" &&
          isRetrievalRoute(decision.route)
        ) {
          answerProjectionFallback = {
            reasonCodes: Array.from(new Set([
              ...(answerProjectionFallback?.reasonCodes ?? []),
              ...finalProjectionValidation.violations,
            ])),
          };
          finalAnswer = {
            ...finalAnswer,
            content: discloseChatAssumptions(
              buildRetrievalAnswer(decision.route, persistedRetrieval),
              effectiveQueryUnderstanding.assumptions,
            ),
            mode: "deterministic" as const,
            entityCandidates: undefined,
          };
          finalizedTurn = finalizeChatTurn({
            citations: persistedRetrieval.citations,
            content: finalAnswer.content,
            outcome: finalAnswer.outcome,
            retrievalError: persistedRetrieval.retrievalError,
          });
          const fallbackValidation = validateAnswer({
            answerOutcome: finalAnswer.outcome,
            answerContent: finalizedTurn.content,
            availableCitations: persistedRetrieval.citations,
            citations: finalizedTurn.citations,
            retrievalError: persistedRetrieval.retrievalError,
            route: decision.route,
            trace: persistedAssistantTrace,
          });
          if (fallbackValidation.status === "fail") {
            throw new Error("deterministic_answer_projection_invalid");
          }
          answerValidation = fallbackValidation;
        } else {
          answerValidation = finalProjectionValidation;
        }
      }
      if(graphResearch)await validateResearchEvidence(graphResearch.research.scope,graphResearch.research.result.evidence);
      if(graphResearch)await validateResearchGraphConnections(graphResearch.research.scope,graphResearch.research.result);
      const agentExecution = isRetrievalRoute(decision.route)
        ? appendValidationToolTrace(
            persistedRetrieval.agentExecution,
            knowledgeBundleIds,
            answerValidation,
          )
        : persistedRetrieval.agentExecution;
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
      const finalTrace = {
        ...persistedAssistantTrace,
        answerConnections: buildChatAnswerConnections(persistedRetrieval.evidence, finalizedTurn.citations, graphResearch?.research.result.graphConnections),
        citationProjection: finalizedTurn.citationProjection,
        evidenceSufficiency: retrieval.metadataClarification
          ? persistedEvidenceSufficiency
          : finalizedTurn.finalSufficiency,
        finalEvidenceStatus: retrieval.metadataClarification
          ? resolveEvidenceStatus(persistedRetrieval)
          : finalizedTurn.finalEvidenceStatus,
        finalizationVersion: "answer-citations-v2" as const,
        relatedEvidence: finalizedTurn.relatedEvidence,
      };
      const knowledgeGap: KnowledgeGapDraft | undefined =
        finalAnswer.outcome === "insufficient_evidence" &&
        isRetrievalRoute(decision.route)
          ? {
              finalEvidenceStatus: finalizedTurn.finalEvidenceStatus,
              question: content,
              reason: finalizedTurn.relatedEvidence.length === 0
                ? "no_matching_evidence"
                : "related_evidence_not_answering",
              retrievalQuery,
              route: decision.route,
              searchedSources: Array.from(new Set([
                ...persistedRetrieval.retrievalToolsCalled,
                ...persistedRetrieval.sourcesRead,
              ])),
              ...(persistedRetrieval.retrievalTriggerCandidates?.length
                ? {
                    retrievalTriggerCandidates:
                      persistedRetrieval.retrievalTriggerCandidates,
                  }
                : {}),
            }
          : undefined;

      return repository.appendUserMessageAndAssistantReply({
        assistantContent: graphResearch?.research.result.coverage==="partial"?`${finalizedTurn.content}\n\nResearch reached its limit. This answer reflects the evidence checked so far; additional applicable information may exist.`:finalizedTurn.content,
        assistantTrace: {
          ...finalTrace,
          ...(finalAdaptiveRetry ? { adaptiveRetry: finalAdaptiveRetry } : {}),
          ...(agentExecution ? { agentExecution } : {}),
          answerMode: finalAnswer.mode,
          answerOutcome: finalAnswer.outcome,
          ...(answerProjectionFallback ? { answerProjectionFallback } : {}),
          answerEvidenceProfile: buildAnswerEvidenceProfile({
            citations: finalizedTurn.citations,
            trace: finalTrace,
          }),
          ...(finalizedTurn.entityCandidates?.length
            ? { entityCandidates: finalizedTurn.entityCandidates }
            : {}),
          ...(answerValidation ? { answerValidation } : {}),
        },
        citations: finalizedTurn.citations,
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

function projectMessageEvidenceForDisplay(message: ChatMessage): ChatMessage {
  if (
    message.role !== "assistant" ||
    message.trace?.finalizationVersion === "answer-citations-v2"
  ) {
    return message;
  }
  const projection = finalizeChatTurn({
    citations: message.citations,
    content: message.content,
    entityCandidates: message.trace?.entityCandidates,
    outcome: message.trace?.answerOutcome,
  });
  return {
    ...message,
    citations: projection.citations,
    content: projection.content,
    trace: message.trace
      ? {
          ...message.trace,
          citationProjection: projection.citationProjection,
          evidenceSufficiency: projection.finalSufficiency,
          finalEvidenceStatus: projection.finalEvidenceStatus,
          relatedEvidence: projection.relatedEvidence,
          ...(projection.entityCandidates
            ? { entityCandidates: projection.entityCandidates }
            : { entityCandidates: undefined }),
        }
      : message.trace,
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

import { generateText, Output } from "ai";
import { z } from "zod";

import { getWorkspaceLlmApiKeyForEnrichment } from "./llm-provider-settings.ts";
import {
  getLlmProvider,
  getSdkModel,
  type LlmProviderId,
} from "./llm-providers.ts";

export type ChatRoute =
  | "okf_only"
  | "rag_only"
  | "hybrid"
  | "missing_context"
  | "unsupported";

export type ChatQueryCategory =
  | "canonical_definition"
  | "policy_or_process"
  | "source_lookup"
  | "open_ended_discovery"
  | "cross_document_summary"
  | "comparison"
  | "high_risk_domain"
  | "live_or_fresh_data"
  | "missing_context"
  | "unsupported";

export type ChatRouterConfidence = "high" | "medium" | "low";

export type ChatRouterDecision = {
  confidence: ChatRouterConfidence;
  constraints: {
    approvedOnly: boolean;
    includeUnreviewed: boolean;
  };
  queryCategory: ChatQueryCategory;
  rationale: string;
  requiredContext: string[];
  route: ChatRoute;
  requiresGraphTraversal?: boolean;
  routerMode?: ChatRouterMode;
};

export type ChatContextField =
  | "subject_or_entity"
  | "applicable_scope_or_version"
  | "source_authority"
  | "intended_action";

export type ChatContextAssumption = {
  basis: "conversation" | "safe_default";
  field: ChatContextField;
  value: string;
};

export type ChatRouterMode = "rules" | "llm_fallback";

// Evidence outcome of a routed answer, per the query-router.md trace
// requirements (final_evidence_status).
export type ChatEvidenceStatus =
  | "approved_evidence"
  | "discovery_evidence"
  | "no_evidence"
  | "retrieval_error";

export type ChatAnswerEvidenceKind = "approved_okf" | "raw_rag" | "mixed" | "none";

export type ChatAnswerTrustLevel = "high" | "medium" | "blocked";

export type ChatAnswerEvidenceProfile = {
  evidenceKind: ChatAnswerEvidenceKind;
  evidenceUsed: Array<"okf" | "rag">;
  fallbackReason?: string;
  okfEvidenceMode?: "direct" | "graph";
  requiresUserVerification: boolean;
  sourceCounts: {
    okf: number;
    rag: number;
    total: number;
  };
  trustLevel: ChatAnswerTrustLevel;
};

export type Stage6aRouterTrace = ChatRouterDecision & {
  // Optional because traces persisted before each field existed don't carry
  // them; absent means the reply predates that tracking.
  answerEvidenceProfile?: ChatAnswerEvidenceProfile;
  answerValidation?: import("./chat-validation.ts").ChatValidationResult;
  answerMode?: "llm" | "deterministic";
  answerModel?: string;
  answerProvider?: string;
  queryUnderstanding?: ChatQueryUnderstandingTrace;
  okfEvidenceMode?: "direct" | "graph";
  okfMatchMode?: "lexical" | "vector";
  rerank?: import("./rag-reranker.ts").RagRerankTrace;
  approvedOkfAvailable?: boolean;
  finalEvidenceStatus?: ChatEvidenceStatus;
  ragUsedForDiscoveryOnly?: boolean;
  retrievalToolsCalled: string[];
  sourcesRead: string[];
  stage: "router";
};

// The full router input contract from docs/architecture/query-router.md.
// The rules below only read the question today; the wider shape is the seam
// the LLM-fallback classifier and eventual agent router will consume.
export type ChatRouterInput = {
  clarificationAlreadyAsked?: boolean;
  conversationContext?: string[];
  question: string;
  workspaceId?: string;
};

export type ChatQueryUnderstandingTrace = {
  ambiguityLevel: "low" | "medium" | "high";
  assumptions: ChatContextAssumption[];
  clarifyingQuestion?: string;
  detectedEntities: string[];
  originalQuestion: string;
  retrievalQuery: string;
  rewriteMode: "fallback_original" | "llm" | "not_needed";
  routeConflict?: {
    optimizedRequiresGraphTraversal: boolean;
    optimizedRoute: ChatRoute;
    originalRequiresGraphTraversal: boolean;
    originalRoute: ChatRoute;
  };
  warnings: string[];
};

export type ChatRouterFallbackInput = ChatRouterInput & {
  rulesDecision: ChatRouterDecision;
};

export type ChatRouterFallbackFn = (
  input: ChatRouterFallbackInput,
) => Promise<ChatRouterDecision | null>;

export type ChatRouterProviderFn = (input: {
  apiKey: string;
  model: string;
  prompt: string;
  provider: LlmProviderId;
}) => Promise<unknown>;

export type RetrievalChatRoute = "okf_only" | "rag_only" | "hybrid";

export function isRetrievalRoute(route: ChatRoute): route is RetrievalChatRoute {
  return route === "okf_only" || route === "rag_only" || route === "hybrid";
}

const MISSING_DECISION_CONTEXT: ChatContextField[] = [
  "subject_or_entity",
  "applicable_scope_or_version",
  "source_authority",
  "intended_action",
];

export function routeChatQuestion(
  input: string | ChatRouterInput,
): ChatRouterDecision {
  const decision = routeChatQuestionBase(input);
  const question = typeof input === "string" ? input : input.question;

  return requiresGraphTraversal(question)
    ? { ...decision, requiresGraphTraversal: true }
    : decision;
}

function routeChatQuestionBase(
  input: string | ChatRouterInput,
): ChatRouterDecision {
  const question = typeof input === "string" ? input : input.question;
  const clarificationAlreadyAsked =
    typeof input === "string" ? false : input.clarificationAlreadyAsked === true;
  const normalized = normalizeQuestion(question);

  const hasKnowledgeSignal =
    matchesAny(normalized, OKF_PATTERNS) ||
    matchesAny(normalized, HYBRID_PATTERNS);

  if (
    matchesAny(normalized, LIVE_OR_EXTERNAL_PATTERNS) &&
    !hasKnowledgeSignal
  ) {
    return {
      confidence: "high",
      constraints: { approvedOnly: false, includeUnreviewed: false },
      queryCategory: "live_or_fresh_data",
      rationale:
        "The question asks for live or external data that static uploaded documents cannot supply.",
      requiredContext: [],
      route: "unsupported",
    };
  }

  const highRisk = matchesAny(normalized, HIGH_RISK_DOMAIN_PATTERNS);
  if (
    !clarificationAlreadyAsked &&
    (matchesAny(normalized, MISSING_CONTEXT_PATTERNS) || highRisk)
  ) {
    return {
      confidence: "high",
      constraints: { approvedOnly: true, includeUnreviewed: false },
      queryCategory: "missing_context",
      rationale:
        highRisk
          ? "The question concerns a high-risk action and needs one combined context check before retrieval."
          : "The question asks for a decision or recommendation without enough subject, scope, source, or intended-action context.",
      requiredContext: MISSING_DECISION_CONTEXT,
      route: "missing_context",
    };
  }

  if (highRisk) {
    return {
      confidence: "medium",
      constraints: { approvedOnly: true, includeUnreviewed: false },
      queryCategory: "high_risk_domain",
      rationale:
        "The question concerns a high-risk operational scenario and requires reviewed source material before any answer is attempted.",
      requiredContext: clarificationAlreadyAsked ? MISSING_DECISION_CONTEXT : [],
      route: "okf_only",
    };
  }

  if (matchesAny(normalized, HYBRID_PATTERNS)) {
    return {
      confidence: "medium",
      constraints: { approvedOnly: false, includeUnreviewed: true },
      queryCategory: "comparison",
      rationale:
        "The question asks for an approved answer plus supporting examples or raw source evidence.",
      requiredContext: [],
      route: "hybrid",
    };
  }

  if (matchesAny(normalized, RAG_PATTERNS)) {
    return {
      confidence: "high",
      constraints: { approvedOnly: false, includeUnreviewed: true },
      queryCategory: "open_ended_discovery",
      rationale:
        "The question asks for broad discovery across uploaded document text rather than a single approved concept.",
      requiredContext: [],
      route: "rag_only",
    };
  }

  if (matchesAny(normalized, OKF_PATTERNS)) {
    return {
      confidence: "high",
      constraints: { approvedOnly: true, includeUnreviewed: false },
      queryCategory: inferOkfCategory(normalized),
      rationale:
        "The question asks for stable, official, or reviewed knowledge that should come from approved OKF content.",
      requiredContext: [],
      route: "okf_only",
    };
  }

  // Plain interrogative questions ("what is X", "how does X work") are
  // canonical per query-router.md's own OKF examples ("What is our refund
  // window?"). Route them to OKF at medium confidence — retrieval downgrades
  // to labeled RAG discovery when no approved OKF evidence exists.
  if (matchesAny(normalized, CANONICAL_QUESTION_PATTERNS)) {
    return {
      confidence: "medium",
      constraints: { approvedOnly: true, includeUnreviewed: false },
      queryCategory: inferOkfCategory(normalized),
      rationale:
        "The question asks directly about a concept or system, which should be answered from approved knowledge first.",
      requiredContext: [],
      route: "okf_only",
    };
  }

  if (clarificationAlreadyAsked) {
    return {
      confidence: "medium",
      constraints: { approvedOnly: true, includeUnreviewed: false },
      queryCategory: "canonical_definition",
      rationale:
        "The session already used its clarification round, so the question proceeds through approved knowledge first with disclosed bounded assumptions when needed.",
      requiredContext: MISSING_DECISION_CONTEXT,
      route: "okf_only",
    };
  }

  return {
    confidence: "low",
    constraints: { approvedOnly: false, includeUnreviewed: false },
    queryCategory: "missing_context",
    rationale:
      "The question does not provide enough signal for a confident OKF, RAG, or hybrid route.",
    requiredContext: ["question_intent"],
    route: "missing_context",
  };
}

export async function routeChatQuestionWithFallback(
  input: string | ChatRouterInput,
  options: {
    classifyWithLlm?: ChatRouterFallbackFn;
  } = {},
): Promise<ChatRouterDecision> {
  const normalizedInput = normalizeRouterInput(input);
  const rulesDecision = routeChatQuestion(normalizedInput);
  const rulesOnly = { ...rulesDecision, routerMode: "rules" as const };

  if (rulesDecision.confidence !== "low") {
    return rulesOnly;
  }

  const classifyWithLlm = options.classifyWithLlm ?? classifyChatRouteWithLlm;

  try {
    const fallbackDecision = await classifyWithLlm({
      ...normalizedInput,
      rulesDecision,
    });

    if (!fallbackDecision) {
      return rulesOnly;
    }

    return {
      ...fallbackDecision,
      ...(requiresGraphTraversal(normalizedInput.question)
        ? { requiresGraphTraversal: true }
        : {}),
      routerMode: "llm_fallback",
    };
  } catch {
    return rulesOnly;
  }
}

export async function classifyChatRouteWithLlm(
  input: ChatRouterFallbackInput,
  options: {
    callProvider?: ChatRouterProviderFn;
    getApiKey?: (
      workspaceId: string,
    ) => Promise<{ apiKey: string; provider: LlmProviderId } | null>;
  } = {},
): Promise<ChatRouterDecision | null> {
  if (!input.workspaceId) {
    return null;
  }

  const getApiKey = options.getApiKey ?? getWorkspaceLlmApiKeyForEnrichment;
  const key = await getApiKey(input.workspaceId);

  if (!key) {
    return null;
  }

  const provider = getLlmProvider(key.provider);
  const prompt = buildRouterFallbackPrompt(input);
  const structuredOutput = await (options.callProvider ?? callRouterProvider)({
    apiKey: key.apiKey,
    model: provider.model,
    prompt,
    provider: provider.id,
  });

  return parseRouterFallbackPayload(structuredOutput);
}

export function buildStage6aRouterTrace(
  decision: ChatRouterDecision,
): Stage6aRouterTrace {
  return {
    ...decision,
    routerMode: decision.routerMode ?? "rules",
    retrievalToolsCalled: [],
    sourcesRead: [],
    stage: "router",
  };
}

export function buildStage6aRouterReply(decision: ChatRouterDecision): string {
  if (decision.route === "okf_only") {
    return "This looks like an approved-knowledge question. Retrieval will be added in the next Stage 6 slice.";
  }

  if (decision.route === "rag_only") {
    return "This looks like a broad document-search question. Retrieval will be added in the next Stage 6 slice.";
  }

  if (decision.route === "hybrid") {
    return "This needs both approved knowledge and raw supporting evidence. Hybrid retrieval will be added in the next Stage 6 slice.";
  }

  if (decision.route === "unsupported") {
    return "I cannot answer that from static uploaded documents alone. This question needs live data or an external system that is not connected yet.";
  }

  return [
    "I need a little more context before routing this safely.",
    `Please provide: ${formatRequiredContext(decision.requiredContext)}.`,
  ].join(" ");
}

function inferOkfCategory(normalized: string): ChatQueryCategory {
  if (
    /\b(manual path|source|authority|authoritative|citation|reference|origin|where documented)\b/.test(
      normalized,
    )
  ) {
    return "source_lookup";
  }

  if (/\b(policy|process|procedure)\b/.test(normalized)) {
    return "policy_or_process";
  }

  return "canonical_definition";
}

function formatRequiredContext(requiredContext: string[]): string {
  return requiredContext
    .map((item) => item.replaceAll("_", " "))
    .join(", ");
}

function normalizeQuestion(question: string): string {
  return question.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeRouterInput(input: string | ChatRouterInput): ChatRouterInput {
  return typeof input === "string" ? { question: input } : input;
}

function requiresGraphTraversal(question: string): boolean {
  return matchesAny(normalizeQuestion(question), GRAPH_TRAVERSAL_PATTERNS);
}

function matchesAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function buildRouterFallbackPrompt(input: ChatRouterFallbackInput): string {
  return [
    "Classify a user question for a document knowledge system.",
    "Use only these routes: okf_only, rag_only, hybrid, missing_context, unsupported.",
    "Use okf_only for stable official reviewed knowledge.",
    "Use rag_only for broad search, summaries, comparisons, or discovery over raw documents.",
    "Use hybrid only when the question needs approved knowledge plus raw supporting examples.",
    "Use missing_context when a safe answer requires more subject, scope, source, version, jurisdiction, or intent context.",
    "Use unsupported for live data, external systems, or requests static documents cannot answer.",
    'Return strict JSON: {"route": string, "queryCategory": string, "confidence": string, "rationale": string, "requiredContext": string[]}',
    "",
    `Question: ${input.question}`,
    input.conversationContext?.length
      ? `Conversation context:\n${input.conversationContext.join("\n")}`
      : "Conversation context: none",
    "",
    `Rules result: ${JSON.stringify(input.rulesDecision)}`,
  ].join("\n");
}

const routerFallbackSchema = z.object({
  confidence: z.enum(["high", "medium", "low"]),
  queryCategory: z.enum([
    "canonical_definition",
    "policy_or_process",
    "source_lookup",
    "open_ended_discovery",
    "cross_document_summary",
    "comparison",
    "high_risk_domain",
    "live_or_fresh_data",
    "missing_context",
    "unsupported",
  ]),
  rationale: z.string(),
  requiredContext: z.array(z.string()),
  route: z.enum(["okf_only", "rag_only", "hybrid", "missing_context", "unsupported"]),
});

function parseRouterFallbackPayload(rawOutput: unknown): ChatRouterDecision | null {
  const parsed = routerFallbackSchema.safeParse(rawOutput);

  if (!parsed.success) {
    return null;
  }

  return {
    confidence: parsed.data.confidence,
    constraints: constraintsForRoute(parsed.data.route),
    queryCategory: parsed.data.queryCategory,
    rationale:
      parsed.data.rationale.trim() || "LLM fallback classified the query.",
    requiredContext: parsed.data.requiredContext,
    route: parsed.data.route,
  };
}

function constraintsForRoute(route: ChatRoute): ChatRouterDecision["constraints"] {
  if (route === "okf_only" || route === "missing_context") {
    return { approvedOnly: true, includeUnreviewed: false };
  }

  if (route === "rag_only" || route === "hybrid") {
    return { approvedOnly: false, includeUnreviewed: true };
  }

  return { approvedOnly: false, includeUnreviewed: false };
}

async function callRouterProvider(input: {
  apiKey: string;
  model: string;
  prompt: string;
  provider: LlmProviderId;
}): Promise<unknown> {
  const result = await generateText({
    model: getSdkModel(input.provider, input.apiKey),
    output: Output.object({ schema: routerFallbackSchema }),
    prompt: input.prompt,
    system:
      "You classify chat questions for a document retrieval router. Return only the requested structured object.",
    temperature: 0,
  });

  return result.output;
}

const LIVE_OR_EXTERNAL_PATTERNS = [
  /\btoday'?s\b/,
  /\bcurrent\b/,
  /\bright now\b/,
  /\blive\b/,
  /\binventory count\b/,
  /\bweather\b/,
  /\bstock price\b/,
];

const MISSING_CONTEXT_PATTERNS = [
  /\bshould i\b/,
  /\bshould we\b/,
  /^can (?:i|we) (?:approve|publish|sign|send|release|delete|change|proceed|act|rely|use|do|dispatch)\b/,
  /^what procedure should i use\??$/,
  /^which procedure should i use\??$/,
];

const HYBRID_PATTERNS = [
  /\b(approved|official|authoritative)\b.*\b(example|examples|supporting|raw|manuals|documents)\b/,
  /\b(example|examples|supporting|raw|manuals|documents)\b.*\b(approved|official|authoritative)\b/,
];

const RAG_PATTERNS = [
  /\bfind all\b/,
  /\bsearch\b/,
  /\bmentions?\b/,
  /\bsummarize\b/,
  /\bcompare\b/,
  /\bsimilar\b/,
  /\bseen this before\b/,
  /\bevery document\b/,
  /\bacross (the )?documents\b/,
];

const CANONICAL_QUESTION_PATTERNS = [
  /^what (is|are|does)\b/,
  /^how (do|does|is|are)\b/,
  /^where (is|are)\b/,
  /^explain\b/,
  /^describe\b/,
];

const HIGH_RISK_DOMAIN_PATTERNS = [
  /\b(safety|emergency|fire|hazard|injury|medical|clinical|legal|regulatory|compliance|financial|payment|security|privacy|data breach|access control)\b.*\b(action|decision|procedure|response|approval|requirement|advice|treatment|shutdown|report)\b/,
  /\b(action|decision|procedure|response|approval|requirement|advice|treatment|shutdown|report)\b.*\b(safety|emergency|fire|hazard|injury|medical|clinical|legal|regulatory|compliance|financial|payment|security|privacy|data breach|access control)\b/,
  /\b(administer medication|wire transfer|delete production data|sign (?:the |a )?contract|emergency shutdown)\b/,
  /\b(engine|apu|fuel|hydraulic|electrical|flight control|brake|landing gear)\b.*\b(fire|failure|fault|emergency|in flight|in-flight)\b/,
  /\b(fire|failure|fault|emergency|in flight|in-flight)\b.*\b(engine|apu|fuel|hydraulic|electrical|flight control|brake|landing gear)\b/,
];

const GRAPH_TRAVERSAL_PATTERNS = [
  /\brelated to\b/,
  /\brelationship between\b/,
  /\bconnected to\b/,
  /\bhow does .* affect\b/,
  /\bimpact of .* on\b/,
  /\bacross (?:the )?(?:systems|concepts|procedures|policies|contracts|reports|records|manuals|documents)\b/,
  /\btrace (?:the )?(?:path|relationship|chain)\b/,
];

const OKF_PATTERNS = [
  /\bofficial\b/,
  /\bapproved\b/,
  /\bdefinition\b/,
  /\bdefine\b/,
  /\bpolicy\b/,
  /\bprocess\b/,
  /\bprocedure\b/,
  /\bsource authority\b/,
  /\bauthoritative\b/,
  /\bmanual path\b/,
  /\bgoverning (?:policy|rule|standard|document)\b/,
  /\b(policy|contract|standard) requirement\b/,
];

import { getWorkspaceLlmApiKeyForEnrichment } from "./llm-provider-settings.ts";
import { getLlmProvider, type LlmProviderId } from "./llm-providers.ts";

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
  routerMode?: ChatRouterMode;
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
  answerMode?: "llm" | "deterministic";
  answerModel?: string;
  answerProvider?: string;
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
  conversationContext?: string[];
  question: string;
  workspaceId?: string;
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
}) => Promise<string>;

export type RetrievalChatRoute = "okf_only" | "rag_only" | "hybrid";

export function isRetrievalRoute(route: ChatRoute): route is RetrievalChatRoute {
  return route === "okf_only" || route === "rag_only" || route === "hybrid";
}

const MISSING_OPERATIONAL_CONTEXT = [
  "aircraft_family",
  "effectivity",
  "source_authority",
  "operational_context",
];

export function routeChatQuestion(
  input: string | ChatRouterInput,
): ChatRouterDecision {
  const question = typeof input === "string" ? input : input.question;
  const normalized = normalizeQuestion(question);

  if (matchesAny(normalized, LIVE_OR_EXTERNAL_PATTERNS)) {
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

  if (matchesAny(normalized, MISSING_CONTEXT_PATTERNS)) {
    return {
      confidence: "high",
      constraints: { approvedOnly: true, includeUnreviewed: false },
      queryCategory: "missing_context",
      rationale:
        "The question asks for an operational decision without enough aircraft, source, or situation context.",
      requiredContext: MISSING_OPERATIONAL_CONTEXT,
      route: "missing_context",
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

    return { ...fallbackDecision, routerMode: "llm_fallback" };
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
  const rawText = await (options.callProvider ?? callRouterProvider)({
    apiKey: key.apiKey,
    model: provider.model,
    prompt,
    provider: provider.id,
  });

  return parseRouterFallbackPayload(rawText);
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
  if (/\b(manual path|source|authority|authoritative)\b/.test(normalized)) {
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
    "Use missing_context when a safe answer requires more aircraft/source/intent context.",
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

function parseRouterFallbackPayload(rawText: string): ChatRouterDecision | null {
  const parsed = JSON.parse(rawText) as {
    confidence?: unknown;
    queryCategory?: unknown;
    rationale?: unknown;
    requiredContext?: unknown;
    route?: unknown;
  };

  if (
    !isChatRoute(parsed.route) ||
    !isQueryCategory(parsed.queryCategory) ||
    !isRouterConfidence(parsed.confidence) ||
    typeof parsed.rationale !== "string" ||
    !Array.isArray(parsed.requiredContext) ||
    !parsed.requiredContext.every((item) => typeof item === "string")
  ) {
    return null;
  }

  return {
    confidence: parsed.confidence,
    constraints: constraintsForRoute(parsed.route),
    queryCategory: parsed.queryCategory,
    rationale: parsed.rationale.trim() || "LLM fallback classified the query.",
    requiredContext: parsed.requiredContext,
    route: parsed.route,
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

function isChatRoute(value: unknown): value is ChatRoute {
  return (
    value === "okf_only" ||
    value === "rag_only" ||
    value === "hybrid" ||
    value === "missing_context" ||
    value === "unsupported"
  );
}

function isQueryCategory(value: unknown): value is ChatQueryCategory {
  return (
    value === "canonical_definition" ||
    value === "policy_or_process" ||
    value === "source_lookup" ||
    value === "open_ended_discovery" ||
    value === "cross_document_summary" ||
    value === "comparison" ||
    value === "high_risk_domain" ||
    value === "live_or_fresh_data" ||
    value === "missing_context" ||
    value === "unsupported"
  );
}

function isRouterConfidence(value: unknown): value is ChatRouterConfidence {
  return value === "high" || value === "medium" || value === "low";
}

async function callRouterProvider(input: {
  apiKey: string;
  model: string;
  prompt: string;
  provider: LlmProviderId;
}): Promise<string> {
  if (input.provider === "anthropic") {
    return callAnthropicRouter(input);
  }

  return callOpenAiRouter(input);
}

async function callAnthropicRouter(input: {
  apiKey: string;
  model: string;
  prompt: string;
}): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    body: JSON.stringify({
      max_tokens: 500,
      messages: [{ content: input.prompt, role: "user" }],
      model: input.model,
      system:
        "You classify chat questions for a document retrieval router. Return only JSON.",
      temperature: 0,
    }),
    headers: {
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
      "x-api-key": input.apiKey,
    },
    method: "POST",
  });
  const rawResponse = await response.text();

  if (!response.ok) {
    throw new Error(`anthropic_router_failed:${response.status}`);
  }

  const parsed = JSON.parse(rawResponse) as {
    content?: Array<{ text?: string; type?: string }>;
  };
  const text = parsed.content?.find((part) => part.type === "text")?.text;

  if (!text) {
    throw new Error("chat_router_malformed_response");
  }

  return text;
}

async function callOpenAiRouter(input: {
  apiKey: string;
  model: string;
  prompt: string;
}): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    body: JSON.stringify({
      messages: [
        {
          content:
            "You classify chat questions for a document retrieval router. Return only JSON.",
          role: "system",
        },
        { content: input.prompt, role: "user" },
      ],
      model: input.model,
      response_format: { type: "json_object" },
      temperature: 0,
    }),
    headers: {
      authorization: `Bearer ${input.apiKey}`,
      "content-type": "application/json",
    },
    method: "POST",
  });
  const rawResponse = await response.text();

  if (!response.ok) {
    throw new Error(`openai_router_failed:${response.status}`);
  }

  const parsed = JSON.parse(rawResponse) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = parsed.choices?.[0]?.message?.content;

  if (!text) {
    throw new Error("chat_router_malformed_response");
  }

  return text;
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
  /^can we dispatch\??$/,
  /^can i dispatch\??$/,
  /\bcan we dispatch\b/,
  /\bshould i\b/,
  /\bshould we\b/,
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
];

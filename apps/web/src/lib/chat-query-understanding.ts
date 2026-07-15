import { generateText, Output } from "ai";
import { z } from "zod";

import {
  routeChatQuestion,
  type ChatContextAssumption,
  type ChatContextField,
  type ChatQueryUnderstandingTrace,
  type ChatRouterDecision,
} from "./chat-router.ts";
import { getWorkspaceLlmApiKeyForEnrichment } from "./llm-provider-settings.ts";
import {
  getLlmProvider,
  getSdkModel,
  type LlmProviderId,
} from "./llm-providers.ts";

const QUERY_UNDERSTANDING_MAX_OUTPUT_TOKENS = 300;

export type ChatQueryUnderstandingInput = {
  clarificationAlreadyAsked?: boolean;
  clarificationOriginQuestion?: string;
  conversationContext?: string[];
  decision: ChatRouterDecision;
  question: string;
  workspaceId: string;
};

export type ChatQueryUnderstandingProviderFn = (input: {
  apiKey: string;
  model: string;
  prompt: string;
  provider: LlmProviderId;
}) => Promise<unknown>;

export type ChatQueryUnderstandingFn = (
  input: ChatQueryUnderstandingInput,
) => Promise<ChatQueryUnderstandingTrace>;

type QueryUnderstandingOptions = {
  callProvider?: ChatQueryUnderstandingProviderFn;
  getApiKey?: (
    workspaceId: string,
  ) => Promise<{ apiKey: string; provider: LlmProviderId } | null>;
};

const contextFieldSchema = z.enum([
  "subject_or_entity",
  "applicable_scope_or_version",
  "source_authority",
  "intended_action",
]);

const assumptionSchema = z.object({
  basis: z.enum(["conversation", "safe_default"]),
  field: contextFieldSchema,
  value: z.string(),
});

const queryUnderstandingSchema = z.object({
  ambiguityLevel: z.enum(["low", "medium", "high"]),
  assumptions: z.array(assumptionSchema),
  clarifyingQuestion: z.string().nullable(),
  detectedEntities: z.array(z.string()),
  retrievalQuery: z.string(),
});

export function shouldRunQueryUnderstanding(input: {
  clarificationAlreadyAsked?: boolean;
  clarificationOriginQuestion?: string;
  decision: ChatRouterDecision;
  question: string;
}): boolean {
  if (
    Boolean(input.clarificationOriginQuestion) ||
    input.decision.confidence === "low" ||
    input.decision.route === "missing_context" ||
    input.decision.routerMode === "llm_fallback"
  ) {
    return true;
  }

  const words = normalizeWhitespace(input.question).split(" ").filter(Boolean);
  const meaningfulWords = words.filter(
    (word) => !QUERY_FILLER_WORDS.has(word.toLowerCase().replace(/[^a-z0-9-]/g, "")),
  );

  return (
    AMBIGUOUS_REFERENCE_PATTERN.test(input.question) ||
    (words.length <= 5 && meaningfulWords.length <= 1)
  );
}

export function buildSkippedQueryUnderstanding(
  question: string,
): ChatQueryUnderstandingTrace {
  return {
    ambiguityLevel: "low",
    assumptions: [],
    detectedEntities: extractProtectedEntities(question),
    originalQuestion: question,
    retrievalQuery: question.trim(),
    rewriteMode: "not_needed",
    warnings: [],
  };
}

export async function understandChatQuery(
  input: ChatQueryUnderstandingInput,
  options: QueryUnderstandingOptions = {},
): Promise<ChatQueryUnderstandingTrace> {
  if (!shouldRunQueryUnderstanding(input)) {
    return buildSkippedQueryUnderstanding(input.question);
  }

  const originalQuestion = input.question.trim();
  const retrievalSeed = buildRetrievalSeed(input);
  const sourceText = [retrievalSeed, ...(input.conversationContext ?? [])].join(" ");
  const protectedEntities = extractProtectedEntities(retrievalSeed);
  const fallback = (warning: string): ChatQueryUnderstandingTrace => ({
    ambiguityLevel: inferFallbackAmbiguity(input.decision),
    assumptions: input.clarificationAlreadyAsked
      ? buildSafeDefaultAssumptions(input.decision.requiredContext)
      : [],
    detectedEntities: protectedEntities,
    originalQuestion,
    retrievalQuery: retrievalSeed,
    rewriteMode: "fallback_original",
    warnings: [warning],
  });

  let key: { apiKey: string; provider: LlmProviderId } | null;
  try {
    key = await (options.getApiKey ?? getWorkspaceLlmApiKeyForEnrichment)(
      input.workspaceId,
    );
  } catch (error) {
    console.error("query_understanding_key_unavailable", error);
    return fallback("query_understanding_key_unavailable");
  }

  if (!key) {
    return fallback("query_understanding_key_not_configured");
  }

  const provider = getLlmProvider(key.provider);
  const prompt = buildQueryUnderstandingPrompt(input, protectedEntities);

  try {
    const output = await (options.callProvider ?? callQueryUnderstandingProvider)({
      apiKey: key.apiKey,
      model: provider.model,
      prompt,
      provider: provider.id,
    });
    const parsed = queryUnderstandingSchema.safeParse(output);

    if (!parsed.success || !parsed.data.retrievalQuery.trim()) {
      return fallback("query_understanding_malformed_response");
    }

    const requiredAssumptionFields = new Set(
      input.decision.requiredContext.filter(isChatContextField),
    );
    const assumptions = input.clarificationAlreadyAsked
      ? validateAssumptions(
          parsed.data.assumptions.filter((assumption) =>
            requiredAssumptionFields.has(assumption.field),
          ),
          sourceText,
        )
      : [];
    if (!assumptions) {
      return fallback("query_understanding_invalid_assumptions");
    }

    const retrievalQuery = appendConversationAssumptions(
      normalizeWhitespace(parsed.data.retrievalQuery),
      assumptions,
    );
    const missingEntities = protectedEntities.filter(
      (entity) => !includesEntity(retrievalQuery, entity),
    );

    if (missingEntities.length > 0) {
      return fallback("query_understanding_dropped_protected_entity");
    }

    const modelEntities = parsed.data.detectedEntities
      .map((entity) => entity.trim())
      .filter(
        (entity) =>
          entity && includesEntity(sourceText, entity) && includesEntity(retrievalQuery, entity),
      );
    const detectedEntities = deduplicateEntities([
      ...protectedEntities,
      ...modelEntities,
    ]);
    const optimizedDecision = routeChatQuestion(retrievalQuery);
    const originalGraph = input.decision.requiresGraphTraversal === true;
    const optimizedGraph = optimizedDecision.requiresGraphTraversal === true;
    const hasRouteConflict =
      optimizedDecision.route !== input.decision.route ||
      optimizedGraph !== originalGraph;
    if (hasRouteConflict) {
      return {
        ...fallback("optimized_query_route_conflict"),
        assumptions,
        routeConflict: {
          optimizedRequiresGraphTraversal: optimizedGraph,
          optimizedRoute: optimizedDecision.route,
          originalRequiresGraphTraversal: originalGraph,
          originalRoute: input.decision.route,
        },
      };
    }

    return {
      ambiguityLevel: parsed.data.ambiguityLevel,
      assumptions,
      ...(parsed.data.clarifyingQuestion?.trim()
        ? { clarifyingQuestion: parsed.data.clarifyingQuestion.trim() }
        : {}),
      detectedEntities,
      originalQuestion,
      retrievalQuery,
      rewriteMode: "llm",
      warnings: [],
    };
  } catch (error) {
    console.error("query_understanding_provider_failed", error);
    return fallback("query_understanding_provider_failed");
  }
}

function buildQueryUnderstandingPrompt(
  input: ChatQueryUnderstandingInput,
  protectedEntities: string[],
): string {
  return [
    "Rewrite a user question into a concise search query for a mixed-domain document knowledge base.",
    "Do not answer the question. Do not select or change the retrieval route.",
    "Preserve exact names, dates, versions, legal citations, policy numbers, standards, contract clauses, case numbers, product codes, acronyms, part numbers, limits, and quoted phrases.",
    "Use conversation context only to resolve references that are genuinely present in the question.",
    "Do not invent people, organizations, products, jurisdictions, dates, versions, document types, or decision context.",
    input.clarificationAlreadyAsked
      ? "A clarification was already requested. Do not ask another question. Use only conversation-grounded assumptions or the listed safe defaults for context that is still missing."
      : "If essential context is missing, provide one concise clarifying question and return no assumptions.",
    "Return a structured object with retrievalQuery, detectedEntities, ambiguityLevel, clarifyingQuestion, and assumptions.",
    "Each assumption must contain field, value, and basis (conversation or safe_default).",
    "Allowed safe defaults: subject_or_entity=all subjects represented in the workspace; applicable_scope_or_version=all available scopes and versions; source_authority=approved OKF first, with raw documents only as labeled discovery; intended_action=informational guidance only, not authorization to act.",
    "",
    `Original question: ${input.question}`,
    input.clarificationOriginQuestion
      ? `Question that triggered clarification: ${input.clarificationOriginQuestion}`
      : "Question that triggered clarification: none",
    `Authoritative route (do not alter): ${input.decision.route}`,
    `Protected entities that must remain exact: ${protectedEntities.join(", ") || "none"}`,
    input.conversationContext?.length
      ? `Conversation context:\n${input.conversationContext.join("\n")}`
      : "Conversation context: none",
  ].join("\n");
}

function buildRetrievalSeed(input: ChatQueryUnderstandingInput): string {
  return normalizeWhitespace(
    [input.clarificationOriginQuestion, input.question].filter(Boolean).join(" "),
  );
}

function buildSafeDefaultAssumptions(
  requiredContext: string[],
): ChatContextAssumption[] {
  const requestedFields = new Set(requiredContext.filter(isChatContextField));

  return [...requestedFields].map((field) => ({
    basis: "safe_default",
    field,
    value: SAFE_CONTEXT_DEFAULTS[field],
  }));
}

function validateAssumptions(
  assumptions: ChatContextAssumption[],
  sourceText: string,
): ChatContextAssumption[] | null {
  const seen = new Set<ChatContextField>();
  const validated: ChatContextAssumption[] = [];

  for (const assumption of assumptions) {
    const value = normalizeWhitespace(assumption.value);
    if (!value || seen.has(assumption.field)) {
      return null;
    }

    if (
      assumption.basis === "conversation" &&
      !includesEntity(sourceText, value)
    ) {
      return null;
    }

    if (
      assumption.basis === "safe_default" &&
      value !== SAFE_CONTEXT_DEFAULTS[assumption.field]
    ) {
      return null;
    }

    seen.add(assumption.field);
    validated.push({ ...assumption, value });
  }

  return validated;
}

function appendConversationAssumptions(
  retrievalQuery: string,
  assumptions: ChatContextAssumption[],
): string {
  const groundedValues = assumptions
    .filter(
      (assumption) =>
        assumption.basis === "conversation" &&
        !includesEntity(retrievalQuery, assumption.value),
    )
    .map((assumption) => assumption.value);

  return normalizeWhitespace([retrievalQuery, ...groundedValues].join(" "));
}

function isChatContextField(value: string): value is ChatContextField {
  return value in SAFE_CONTEXT_DEFAULTS;
}

async function callQueryUnderstandingProvider(input: {
  apiKey: string;
  model: string;
  prompt: string;
  provider: LlmProviderId;
}): Promise<unknown> {
  const result = await generateText({
    model: getSdkModel(input.provider, input.apiKey),
    output: Output.object({ schema: queryUnderstandingSchema }),
    prompt: input.prompt,
    system:
      "You optimize search queries without answering them or changing routing. Return only the requested structured object.",
    maxOutputTokens: QUERY_UNDERSTANDING_MAX_OUTPUT_TOKENS,
    temperature: 0,
  });

  return result.output;
}

function extractProtectedEntities(question: string): string[] {
  const quotedPhrases = [
    ...(question.match(/"[^"]+"/g) ?? []).map((value) => value.slice(1, -1)),
    ...(question.match(/\u201c[^\u201d]+\u201d/g) ?? []).map((value) =>
      value.slice(1, -1),
    ),
  ];
  const matches = [
    ...quotedPhrases,
    ...(question.match(/["“][^"”]+["”]/g) ?? []).map((value) =>
      value.replace(/^["“]|["”]$/g, ""),
    ),
    ...(question.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? []),
    ...(question.match(/\bv?\d+(?:\.\d+){1,3}\b/gi) ?? []),
    ...(question.match(/\b(?:ISO|SOC|NIST|GDPR|HIPAA|PCI(?: DSS)?|CFR)\s*[A-Z0-9.-]*\b/gi) ?? []),
    ...(question.match(/\b(?:article|section|clause|policy|case|ticket|contract)\s+(?:no\.?\s*)?[A-Z0-9][A-Z0-9._/-]*\b/gi) ?? []),
    ...(question.match(/\b\d{2}(?:-\d{2}){1,2}\b/g) ?? []),
    ...(question.match(/\b[A-Z][A-Z0-9]{1,}(?:[/-][A-Z0-9]+)*\b/g) ?? []),
    ...(question.match(/\b[A-Za-z0-9]+(?:-[A-Za-z0-9]+){1,}\b/g) ?? []),
  ];

  return deduplicateEntities(matches);
}

function deduplicateEntities(entities: string[]): string[] {
  const seen = new Set<string>();
  return entities.filter((entity) => {
    const key = entity.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function includesEntity(value: string, entity: string): boolean {
  const escaped = entity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(value);
}

function inferFallbackAmbiguity(
  decision: ChatRouterDecision,
): ChatQueryUnderstandingTrace["ambiguityLevel"] {
  if (decision.route === "missing_context" || decision.confidence === "low") {
    return "high";
  }
  return "medium";
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

const AMBIGUOUS_REFERENCE_PATTERN = /\b(it|this|that|these|those|they|them|there)\b/i;

const SAFE_CONTEXT_DEFAULTS: Record<ChatContextField, string> = {
  applicable_scope_or_version: "all available scopes and versions",
  intended_action: "informational guidance only, not authorization to act",
  source_authority: "approved OKF first, with raw documents only as labeled discovery",
  subject_or_entity: "all subjects represented in the workspace",
};

const QUERY_FILLER_WORDS = new Set([
  "a",
  "an",
  "and",
  "check",
  "document",
  "help",
  "how",
  "is",
  "it",
  "manual",
  "of",
  "procedure",
  "system",
  "that",
  "the",
  "this",
  "to",
  "what",
]);

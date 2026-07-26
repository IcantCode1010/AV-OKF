import { generateText, Output } from "ai";
import { z } from "zod";

import type { EvidenceSufficiency } from "./chat-evidence-sufficiency.ts";
import {
  extractProtectedEntities,
  includesEntity,
} from "./chat-query-understanding.ts";
import {
  getLlmProvider,
  getSdkModel,
  type LlmProviderId,
} from "./llm-providers.ts";
import { getWorkspaceLlmApiKeyForEnrichment } from "./llm-provider-settings.ts";
import {
  routeChatQuestion,
  type ChatRouterDecision,
} from "./chat-router.ts";

const adaptiveRetrySchema = z.object({
  expansionTerms: z.array(
    z.string().trim().min(1).max(100),
  ).min(1).max(8),
  reason: z.string().trim().min(1).max(500),
});

export type AdaptiveRetryStatus =
  | "disabled"
  | "not_eligible"
  | "applied"
  | "missing_key"
  | "provider_failed"
  | "malformed_response"
  | "rejected_route_change"
  | "rejected_scope_change"
  | "rejected_identifier_loss"
  | "rejected_equivalent_query"
  | "no_improvement"
  | "validation_failed";

export type AdaptiveRetryTrace = {
  eligible: boolean;
  enabledBundleIds: string[];
  evidenceDelta: {
    approvedOkf: number;
    citations: number;
    rawRag: number;
  };
  fallbackUsed: boolean;
  model?: string;
  originalSufficiency: EvidenceSufficiency;
  outcome: AdaptiveRetryStatus;
  provider?: LlmProviderId;
  retryQuery?: string;
  retryReason?: string;
  usage?: AdaptiveRetryUsage;
  validationStatus?: "pass" | "fail";
};

export type AdaptiveRetryUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

type AdaptiveRetryProviderResult = {
  output: unknown;
  usage?: AdaptiveRetryUsage;
};

type AdaptiveRetryProvider = (input: {
  apiKey: string;
  model: string;
  prompt: string;
  provider: LlmProviderId;
}) => Promise<unknown | AdaptiveRetryProviderResult>;

export async function createBoundedAdaptiveRetryQuery(
  input: {
    decision: ChatRouterDecision;
    enabledBundleIds: string[];
    originalQuery: string;
    sufficiency: EvidenceSufficiency;
    workspaceId: string;
  },
  options: {
    callProvider?: AdaptiveRetryProvider;
    getApiKey?: typeof getWorkspaceLlmApiKeyForEnrichment;
  } = {},
): Promise<{ query?: string; trace: AdaptiveRetryTrace }> {
  const eligible =
    (input.sufficiency.status === "weak" ||
      input.sufficiency.status === "partial") &&
    input.enabledBundleIds.length > 0;
  const baseTrace: AdaptiveRetryTrace = {
    eligible,
    enabledBundleIds: [...input.enabledBundleIds],
    evidenceDelta: { approvedOkf: 0, citations: 0, rawRag: 0 },
    fallbackUsed: false,
    originalSufficiency: input.sufficiency,
    outcome:
      input.enabledBundleIds.length === 0 ? "disabled" : "not_eligible",
  };
  if (!eligible) return { trace: baseTrace };

  let key: { apiKey: string; provider: LlmProviderId } | null;
  try {
    key = await (options.getApiKey ?? getWorkspaceLlmApiKeyForEnrichment)(
      input.workspaceId,
    );
  } catch (error) {
    console.error("adaptive_retry_key_unavailable", error);
    return {
      trace: { ...baseTrace, fallbackUsed: true, outcome: "missing_key" },
    };
  }
  if (!key) {
    return {
      trace: { ...baseTrace, fallbackUsed: true, outcome: "missing_key" },
    };
  }

  const provider = getLlmProvider(key.provider);
  const protectedEntities = extractProtectedEntities(input.originalQuery);
  const prompt = buildAdaptiveRetryPrompt({
    decision: input.decision,
    originalQuery: input.originalQuery,
    protectedEntities,
    sufficiency: input.sufficiency,
  });
  let providerResult: unknown | AdaptiveRetryProviderResult;
  try {
    providerResult = await (options.callProvider ?? callAdaptiveRetryProvider)({
      apiKey: key.apiKey,
      model: provider.model,
      prompt,
      provider: provider.id,
    });
  } catch (error) {
    console.error("adaptive_retry_provider_failed", error);
    return {
      trace: {
        ...baseTrace,
        fallbackUsed: true,
        model: provider.model,
        outcome: "provider_failed",
        provider: provider.id,
      },
    };
  }

  const { output, usage } = unwrapProviderResult(providerResult);
  const parsed = adaptiveRetrySchema.safeParse(output);
  if (!parsed.success) {
    return {
      trace: {
        ...baseTrace,
        fallbackUsed: true,
        model: provider.model,
        outcome: "malformed_response",
        provider: provider.id,
        ...(usage ? { usage } : {}),
      },
    };
  }
  const expansionTerms = normalizeExpansionTerms(
    parsed.data.expansionTerms,
    input.originalQuery,
  );
  if (expansionTerms.length === 0) {
    return {
      trace: {
        ...baseTrace,
        fallbackUsed: true,
        model: provider.model,
        outcome: "rejected_equivalent_query",
        provider: provider.id,
        ...(usage ? { usage } : {}),
      },
    };
  }
  const retryQuery = normalizeWhitespace(
    `${input.originalQuery} ${expansionTerms.join(" ")}`,
  );
  const retryDecision = routeChatQuestion(retryQuery);
  if (
    retryDecision.route !== input.decision.route ||
    Boolean(retryDecision.requiresGraphTraversal) !==
      Boolean(input.decision.requiresGraphTraversal)
  ) {
    return {
      trace: {
        ...baseTrace,
        fallbackUsed: true,
        model: provider.model,
        outcome: "rejected_route_change",
        provider: provider.id,
        ...(usage ? { usage } : {}),
      },
    };
  }
  if (expansionTerms.some((term) => containsScopeDirective(term))) {
    return {
      trace: {
        ...baseTrace,
        fallbackUsed: true,
        model: provider.model,
        outcome: "rejected_scope_change",
        provider: provider.id,
        ...(usage ? { usage } : {}),
      },
    };
  }
  if (
    protectedEntities.some((entity) => !includesEntity(retryQuery, entity))
  ) {
    return {
      trace: {
        ...baseTrace,
        fallbackUsed: true,
        model: provider.model,
        outcome: "rejected_identifier_loss",
        provider: provider.id,
        ...(usage ? { usage } : {}),
      },
    };
  }
  if (normalizeForComparison(retryQuery) === normalizeForComparison(input.originalQuery)) {
    return {
      trace: {
        ...baseTrace,
        fallbackUsed: true,
        model: provider.model,
        outcome: "rejected_equivalent_query",
        provider: provider.id,
        ...(usage ? { usage } : {}),
      },
    };
  }

  return {
    query: retryQuery,
    trace: {
      ...baseTrace,
      model: provider.model,
      outcome: "applied",
      provider: provider.id,
      retryQuery,
      retryReason: parsed.data.reason,
      ...(usage ? { usage } : {}),
    },
  };
}

function buildAdaptiveRetryPrompt(input: {
  decision: ChatRouterDecision;
  originalQuery: string;
  protectedEntities: string[];
  sufficiency: EvidenceSufficiency;
}): string {
  const target =
    input.sufficiency.status === "partial"
      ? `Add terminology only for this named evidence gap: ${input.sufficiency.namedGap}`
      : "Add likely canonical title, heading, policy, procedure, or controlled-vocabulary terminology for the user's subject.";
  return [
    "Expand one retrieval query for a mixed-domain knowledge system.",
    "Do not answer the question and do not choose tools.",
    "The application keeps the original query unchanged and appends your expansionTerms.",
    "Return 1-8 short canonical noun phrases, not a rewritten question.",
    "Prefer terminology likely to appear in a document title, concept title, section heading, policy name, procedure name, or controlled vocabulary.",
    "Replace paraphrased ideas with likely canonical synonyms, but do not repeat terms already present in the original query.",
    "Avoid generic filler such as best practices, general information, guidance, overview, authoritative knowledge, or more details.",
    "Do not add live/current/latest signals, route cues, instructions, a workspace ID, a bundle ID, or a new knowledge source.",
    "The route, selected knowledge bundles, lifecycle rules, graph decision, and evidence trust policy are immutable.",
    "Protected identifiers are already retained by the application; do not alter or restate them.",
    target,
    "Return only structured expansionTerms and a concise reason.",
    `Authoritative route: ${input.decision.route}`,
    `Graph traversal required: ${Boolean(input.decision.requiresGraphTraversal)}`,
    `Original query: ${input.originalQuery}`,
    `Evidence sufficiency: ${JSON.stringify(input.sufficiency)}`,
    `Protected identifiers: ${input.protectedEntities.join(", ") || "none"}`,
  ].join("\n");
}

async function callAdaptiveRetryProvider(input: {
  apiKey: string;
  model: string;
  prompt: string;
  provider: LlmProviderId;
}): Promise<AdaptiveRetryProviderResult> {
  const result = await generateText({
    maxOutputTokens: 400,
    model: getSdkModel(input.provider, input.apiKey),
    output: Output.object({ schema: adaptiveRetrySchema }),
    prompt: input.prompt,
    system:
      "You improve one search query without changing routing, scope, trust, or identifiers. Return only the requested structured object.",
    temperature: 0,
  });
  return {
    output: result.output,
    usage: compactUsage(result.usage),
  };
}

function unwrapProviderResult(
  value: unknown | AdaptiveRetryProviderResult,
): AdaptiveRetryProviderResult {
  if (
    value &&
    typeof value === "object" &&
    "output" in value &&
    ("usage" in value || Object.keys(value).length <= 2)
  ) {
    const result = value as AdaptiveRetryProviderResult;
    return {
      output: result.output,
      ...(result.usage ? { usage: compactUsage(result.usage) } : {}),
    };
  }
  return { output: value };
}

function compactUsage(usage: AdaptiveRetryUsage): AdaptiveRetryUsage | undefined {
  const compact = {
    ...(typeof usage.inputTokens === "number"
      ? { inputTokens: usage.inputTokens }
      : {}),
    ...(typeof usage.outputTokens === "number"
      ? { outputTokens: usage.outputTokens }
      : {}),
    ...(typeof usage.totalTokens === "number"
      ? { totalTokens: usage.totalTokens }
      : {}),
  };
  return Object.keys(compact).length > 0 ? compact : undefined;
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeForComparison(value: string): string {
  return normalizeWhitespace(value).normalize("NFKC").toLowerCase();
}

function normalizeExpansionTerms(
  values: string[],
  originalQuery: string,
): string[] {
  const original = normalizeForComparison(originalQuery);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const term = normalizeWhitespace(value);
    const normalized = normalizeForComparison(term);
    if (
      !normalized ||
      seen.has(normalized) ||
      includesNormalizedPhrase(original, normalized)
    ) {
      continue;
    }
    seen.add(normalized);
    result.push(term);
  }
  return result;
}

function includesNormalizedPhrase(haystack: string, needle: string): boolean {
  return ` ${haystack} `.includes(` ${needle} `);
}

function containsScopeDirective(value: string): boolean {
  return /\b(?:bundle|workspace)\s*(?:id|scope)?\s*[:=]\s*[a-z0-9_-]+/i.test(
    value,
  );
}

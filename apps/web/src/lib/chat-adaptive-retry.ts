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
  reason: z.string().trim().min(1).max(500),
  retryQuery: z.string().trim().min(1).max(2_000),
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
  validationStatus?: "pass" | "fail";
};

type AdaptiveRetryProvider = (input: {
  apiKey: string;
  model: string;
  prompt: string;
  provider: LlmProviderId;
}) => Promise<unknown>;

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
  let output: unknown;
  try {
    output = await (options.callProvider ?? callAdaptiveRetryProvider)({
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

  const parsed = adaptiveRetrySchema.safeParse(output);
  if (!parsed.success) {
    return {
      trace: {
        ...baseTrace,
        fallbackUsed: true,
        model: provider.model,
        outcome: "malformed_response",
        provider: provider.id,
      },
    };
  }
  const retryQuery = normalizeWhitespace(parsed.data.retryQuery);
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
      },
    };
  }
  if (
    /\b(?:bundle|workspace)\s*(?:id|scope)?\s*[:=]\s*[a-z0-9_-]+/i.test(
      retryQuery,
    )
  ) {
    return {
      trace: {
        ...baseTrace,
        fallbackUsed: true,
        model: provider.model,
        outcome: "rejected_scope_change",
        provider: provider.id,
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
    },
  };
}

function buildAdaptiveRetryPrompt(input: {
  decision: ChatRouterDecision;
  originalQuery: string;
  protectedEntities: string[];
  sufficiency: EvidenceSufficiency;
}): string {
  return [
    "Broaden or rephrase one retrieval query for a mixed-domain knowledge system.",
    "Do not answer the question and do not choose tools.",
    "The route, selected knowledge bundles, lifecycle rules, and evidence trust policy are immutable.",
    "Preserve every protected identifier exactly.",
    "Do not mention or request a workspace ID, bundle ID, or new knowledge source.",
    "Return one structured retryQuery and a concise reason.",
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
}): Promise<unknown> {
  const result = await generateText({
    maxOutputTokens: 400,
    model: getSdkModel(input.provider, input.apiKey),
    output: Output.object({ schema: adaptiveRetrySchema }),
    prompt: input.prompt,
    system:
      "You improve one search query without changing routing, scope, trust, or identifiers. Return only the requested structured object.",
    temperature: 0,
  });
  return result.output;
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeForComparison(value: string): string {
  return normalizeWhitespace(value).normalize("NFKC").toLowerCase();
}

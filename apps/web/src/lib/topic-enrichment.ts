import type { AuthWorkspaceContext } from "./auth-workspace.ts";
import { requireAuthWorkspaceContext } from "./auth-workspace.ts";
import {
  approveTopicContent,
  completeTopicEnrichment,
  failTopicEnrichment,
  getTopicEnrichmentInput,
  markTopicEnrichmentPending,
  type ApprovedContentSource,
  type ExtractedPageRecord,
  type TopicRecord,
} from "./document-backend.ts";
import { getWorkspaceLlmApiKeyForEnrichment } from "./llm-provider-settings.ts";
import {
  getLlmProvider,
  LLM_PROVIDERS,
  type LlmProviderId,
} from "./llm-providers.ts";

export type TopicEnrichmentProviderInput = {
  apiKey: string;
  prompt: string;
  sourcePages: ExtractedPageRecord[];
  summary: string;
  title: string;
};

export type TopicEnrichmentProviderOutput = {
  rawResponse: string;
  summary: string;
  title: string;
};

export type TopicEnrichmentProvider = {
  model: string;
  provider: LlmProviderId;
  enrich(
    input: TopicEnrichmentProviderInput,
  ): Promise<TopicEnrichmentProviderOutput>;
};

export type TopicEnrichmentRepository = {
  approveTopicContent(input: {
    approvedContentSource: ApprovedContentSource;
    context: AuthWorkspaceContext;
    topicId: string;
  }): Promise<TopicRecord>;
  completeTopicEnrichment(input: {
    context: AuthWorkspaceContext;
    enrichedSummary: string;
    enrichedTitle: string;
    model: string;
    promptSent: string;
    provider: string;
    rawResponse: string;
    requestedBy: string;
    topicId: string;
  }): Promise<TopicRecord>;
  failTopicEnrichment(input: {
    context: AuthWorkspaceContext;
    errorMessage: string;
    model: string;
    promptSent: string;
    provider: string;
    rawResponse: string;
    requestedBy: string;
    topicId: string;
  }): Promise<TopicRecord>;
  getTopicEnrichmentInput(input: {
    context: AuthWorkspaceContext;
    topicId: string;
  }): Promise<{ sourcePages: ExtractedPageRecord[]; topic: TopicRecord }>;
  markTopicEnrichmentPending(input: {
    context: AuthWorkspaceContext;
    topicId: string;
  }): Promise<TopicRecord>;
};

type EnrichTopicOptions = {
  context?: AuthWorkspaceContext;
  getApiKey?: (
    workspaceId: string,
  ) => Promise<{ apiKey: string; provider: LlmProviderId | string } | string | null>;
  provider?: TopicEnrichmentProvider;
  providerFactory?: (providerId: LlmProviderId) => TopicEnrichmentProvider;
  repository?: TopicEnrichmentRepository;
};

type ApproveTopicOptions = {
  context?: AuthWorkspaceContext;
  repository?: Pick<TopicEnrichmentRepository, "approveTopicContent">;
};

const ANTHROPIC_PROVIDER = getLlmProvider(LLM_PROVIDERS[0].id);
const OPENAI_PROVIDER = getLlmProvider(LLM_PROVIDERS[1].id);

export async function enrichTopic(
  topicId: string,
  options: EnrichTopicOptions = {},
): Promise<TopicRecord> {
  const context = options.context ?? (await requireAuthWorkspaceContext());
  const repository = options.repository ?? createDefaultTopicEnrichmentRepository();
  const { topic, sourcePages } = await repository.getTopicEnrichmentInput({
    context,
    topicId,
  });

  if (topic.reviewStatus === "approved") {
    throw new Error("topic_enrichment_requires_unapproved_topic");
  }

  const key = await resolveApiKey(context.workspaceId, options.getApiKey);
  if (!key) {
    throw new Error("llm_enrichment_requires_api_key");
  }

  const provider =
    options.provider ??
    options.providerFactory?.(key.provider) ??
    createTopicEnrichmentProvider(key.provider);

  await repository.markTopicEnrichmentPending({ context, topicId });

  const prompt = buildTopicEnrichmentPrompt({ sourcePages, topic });
  try {
    const result = await provider.enrich({
      apiKey: key.apiKey,
      prompt,
      sourcePages,
      summary: topic.summary,
      title: topic.title,
    });
    const enrichedTitle = result.title.trim();
    const enrichedSummary = result.summary.trim();

    if (!enrichedTitle || !enrichedSummary) {
      throw new Error("llm_enrichment_empty_response");
    }

    return repository.completeTopicEnrichment({
      context,
      enrichedSummary,
      enrichedTitle,
      model: provider.model,
      promptSent: prompt,
      provider: provider.provider,
      rawResponse: result.rawResponse,
      requestedBy: context.userId,
      topicId,
    });
  } catch (error) {
    return repository.failTopicEnrichment({
      context,
      errorMessage: normalizeErrorMessage(error),
      model: provider.model,
      promptSent: prompt,
      provider: provider.provider,
      rawResponse: error instanceof Error ? error.message : String(error),
      requestedBy: context.userId,
      topicId,
    });
  }
}

export async function approveTopicContentSource(
  topicId: string,
  approvedContentSource: ApprovedContentSource,
  options: ApproveTopicOptions = {},
): Promise<TopicRecord> {
  const context = options.context ?? (await requireAuthWorkspaceContext());
  const repository = options.repository ?? createDefaultTopicEnrichmentRepository();

  return repository.approveTopicContent({
    approvedContentSource,
    context,
    topicId,
  });
}

export function buildTopicEnrichmentPrompt(input: {
  sourcePages: ExtractedPageRecord[];
  topic: TopicRecord;
}) {
  const sourceText = input.sourcePages
    .map((page) => `Page ${page.pageNumber}\n${page.text}`)
    .join("\n\n---\n\n");

  return [
    "You are polishing a draft technical topic for a document knowledge base.",
    "Use only the supplied source text. Do not invent facts, applicability, warnings, or procedures that are not present in the source.",
    "Do not change the technical meaning. Improve clarity, structure, and wording only.",
    "Return strict JSON with string fields: title, summary.",
    "",
    `Current title: ${input.topic.title}`,
    `Current summary: ${input.topic.summary}`,
    "",
    "Source text:",
    sourceText || "No source text was available for this topic.",
  ].join("\n");
}

export function createTopicEnrichmentProvider(
  providerId: LlmProviderId,
): TopicEnrichmentProvider {
  const provider = getLlmProvider(providerId);

  if (provider.id === ANTHROPIC_PROVIDER.id) {
    return createAnthropicTopicEnrichmentProvider();
  }

  if (provider.id === OPENAI_PROVIDER.id) {
    return createOpenAiTopicEnrichmentProvider();
  }

  throw new Error("unsupported_llm_provider");
}

function createDefaultTopicEnrichmentRepository(): TopicEnrichmentRepository {
  return {
    approveTopicContent: async (input) =>
      approveTopicContent(input.topicId, input.approvedContentSource),
    completeTopicEnrichment: async (input) =>
      completeTopicEnrichment(input.topicId, input),
    failTopicEnrichment: async (input) => failTopicEnrichment(input.topicId, input),
    getTopicEnrichmentInput: async (input) =>
      getTopicEnrichmentInput(input.topicId),
    markTopicEnrichmentPending: async (input) =>
      markTopicEnrichmentPending(input.topicId),
  };
}

async function resolveApiKey(
  workspaceId: string,
  getApiKey?: EnrichTopicOptions["getApiKey"],
) {
  const resolved = getApiKey
    ? await getApiKey(workspaceId)
    : await getWorkspaceLlmApiKeyForEnrichment(workspaceId);

  if (!resolved) {
    return null;
  }

  if (typeof resolved === "string") {
    return {
      apiKey: resolved,
      provider: ANTHROPIC_PROVIDER.id,
    };
  }

  return {
    apiKey: resolved.apiKey,
    provider: getLlmProvider(resolved.provider).id,
  };
}

function createAnthropicTopicEnrichmentProvider(): TopicEnrichmentProvider {
  return {
    model: ANTHROPIC_PROVIDER.model,
    provider: ANTHROPIC_PROVIDER.id,
    async enrich(input) {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        body: JSON.stringify({
          max_tokens: 1200,
          messages: [{ content: input.prompt, role: "user" }],
          model: ANTHROPIC_PROVIDER.model,
          system:
            "You enrich topic records for a technical knowledge base. Return only JSON.",
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
        throw new Error(`anthropic_request_failed:${response.status}`);
      }

      return parseAnthropicResponse(rawResponse);
    },
  };
}

export function createOpenAiTopicEnrichmentProvider(
  fetchImplementation: typeof fetch = fetch,
): TopicEnrichmentProvider {
  return {
    model: OPENAI_PROVIDER.model,
    provider: OPENAI_PROVIDER.id,
    async enrich(input) {
      const response = await fetchImplementation(
        "https://api.openai.com/v1/chat/completions",
        {
          body: JSON.stringify({
            messages: [
              {
                content:
                  "You enrich topic records for a technical knowledge base. Return only JSON.",
                role: "system",
              },
              { content: input.prompt, role: "user" },
            ],
            model: OPENAI_PROVIDER.model,
            response_format: { type: "json_object" },
          }),
          headers: {
            authorization: `Bearer ${input.apiKey}`,
            "content-type": "application/json",
          },
          method: "POST",
        },
      );
      const rawResponse = await response.text();

      if (!response.ok) {
        throw new Error(`openai_request_failed:${response.status}`);
      }

      return parseOpenAiResponse(rawResponse);
    },
  };
}

function parseAnthropicResponse(rawResponse: string): TopicEnrichmentProviderOutput {
  const parsed = JSON.parse(rawResponse) as {
    content?: Array<{ text?: string; type?: string }>;
  };
  const text = parsed.content?.find((part) => part.type === "text")?.text;

  if (!text) {
    throw new Error("llm_enrichment_malformed_response");
  }

  return parseProviderJsonPayload(text, rawResponse);
}

function parseOpenAiResponse(rawResponse: string): TopicEnrichmentProviderOutput {
  const parsed = parseJson(rawResponse) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = parsed.choices?.[0]?.message?.content;

  if (!text) {
    throw new Error("llm_enrichment_malformed_response");
  }

  return parseProviderJsonPayload(text, rawResponse);
}

function parseProviderJsonPayload(
  jsonText: string,
  rawResponse: string,
): TopicEnrichmentProviderOutput {
  const payload = parseJson(jsonText) as { summary?: unknown; title?: unknown };

  if (typeof payload.title !== "string" || typeof payload.summary !== "string") {
    throw new Error("llm_enrichment_malformed_response");
  }

  return {
    rawResponse,
    summary: payload.summary,
    title: payload.title,
  };
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error("llm_enrichment_malformed_response");
  }
}

function normalizeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

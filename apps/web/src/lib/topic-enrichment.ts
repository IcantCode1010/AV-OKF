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
  provider: string;
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
  ) => Promise<{ apiKey: string; provider: string } | string | null>;
  provider?: TopicEnrichmentProvider;
  repository?: TopicEnrichmentRepository;
};

type ApproveTopicOptions = {
  context?: AuthWorkspaceContext;
  repository?: Pick<TopicEnrichmentRepository, "approveTopicContent">;
};

const ANTHROPIC_MODEL = "claude-3-5-haiku-20241022";

export async function enrichTopic(
  topicId: string,
  options: EnrichTopicOptions = {},
): Promise<TopicRecord> {
  const context = options.context ?? (await requireAuthWorkspaceContext());
  const repository = options.repository ?? createDefaultTopicEnrichmentRepository();
  const provider = options.provider ?? createAnthropicTopicEnrichmentProvider();
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
      provider: "anthropic",
    };
  }

  return resolved;
}

function createAnthropicTopicEnrichmentProvider(): TopicEnrichmentProvider {
  return {
    model: ANTHROPIC_MODEL,
    provider: "anthropic",
    async enrich(input) {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        body: JSON.stringify({
          max_tokens: 1200,
          messages: [{ content: input.prompt, role: "user" }],
          model: ANTHROPIC_MODEL,
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

function parseAnthropicResponse(rawResponse: string): TopicEnrichmentProviderOutput {
  const parsed = JSON.parse(rawResponse) as {
    content?: Array<{ text?: string; type?: string }>;
  };
  const text = parsed.content?.find((part) => part.type === "text")?.text;

  if (!text) {
    throw new Error("llm_enrichment_malformed_response");
  }

  const payload = JSON.parse(text) as { summary?: unknown; title?: unknown };

  if (typeof payload.title !== "string" || typeof payload.summary !== "string") {
    throw new Error("llm_enrichment_malformed_response");
  }

  return {
    rawResponse,
    summary: payload.summary,
    title: payload.title,
  };
}

function normalizeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

import { generateText, Output } from "ai";
import { z } from "zod";

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
  getSdkModel,
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
  body?: string;
  proposedSourcePageNumbers?: number[];
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

type TopicEnrichmentOutputGenerator = (input: {
  apiKey: string;
  model: string;
  prompt: string;
  provider: LlmProviderId;
}) => Promise<unknown>;

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
    enrichedBody?: string;
    proposedSourcePageNumbers?: number[];
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
const topicEnrichmentSchema = z.object({
  body: z.string().default(""),
  proposedSourcePageNumbers: z.array(z.number().int().positive()).default([]),
  summary: z.string(),
  title: z.string(),
});

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
    const enrichedBody = (result.body ?? result.summary).trim();
    const proposedSourcePageNumbers = [...new Set(result.proposedSourcePageNumbers ?? [])]
      .filter((page) => sourcePages.some((sourcePage) => sourcePage.pageNumber === page))
      .filter((page) => !topic.sourcePageNumbers.includes(page))
      .sort((left, right) => left - right);

    if (!enrichedTitle || !enrichedSummary) {
      throw new Error("llm_enrichment_empty_response");
    }

    return repository.completeTopicEnrichment({
      context,
      enrichedSummary,
      enrichedTitle,
      enrichedBody,
      proposedSourcePageNumbers,
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
    "Return strict JSON with title, summary, body, and proposedSourcePageNumbers.",
    "Keep summary concise. Body must be a structured Markdown article grounded only in source text.",
    "Only propose page numbers from the supplied source context; proposals require reviewer acceptance.",
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

function createAnthropicTopicEnrichmentProvider(
  generateOutput: TopicEnrichmentOutputGenerator = generateTopicEnrichmentOutput,
): TopicEnrichmentProvider {
  return {
    model: ANTHROPIC_PROVIDER.model,
    provider: ANTHROPIC_PROVIDER.id,
    async enrich(input) {
      const output = await generateOutput({
        apiKey: input.apiKey,
        model: ANTHROPIC_PROVIDER.model,
        prompt: input.prompt,
        provider: ANTHROPIC_PROVIDER.id,
      });
      const parsed = topicEnrichmentSchema.safeParse(output);

      if (!parsed.success) {
        throw new Error("llm_enrichment_malformed_response");
      }

      return {
        rawResponse: JSON.stringify(output),
        body: parsed.data.body,
        proposedSourcePageNumbers: parsed.data.proposedSourcePageNumbers,
        summary: parsed.data.summary,
        title: parsed.data.title,
      };
    },
  };
}

export function createOpenAiTopicEnrichmentProvider(
  generateOutput: TopicEnrichmentOutputGenerator = generateTopicEnrichmentOutput,
): TopicEnrichmentProvider {
  return {
    model: OPENAI_PROVIDER.model,
    provider: OPENAI_PROVIDER.id,
    async enrich(input) {
      const output = await generateOutput({
        apiKey: input.apiKey,
        model: OPENAI_PROVIDER.model,
        prompt: input.prompt,
        provider: OPENAI_PROVIDER.id,
      });
      const parsed = topicEnrichmentSchema.safeParse(output);

      if (!parsed.success) {
        throw new Error("llm_enrichment_malformed_response");
      }

      return {
        rawResponse: JSON.stringify(output),
        body: parsed.data.body,
        proposedSourcePageNumbers: parsed.data.proposedSourcePageNumbers,
        summary: parsed.data.summary,
        title: parsed.data.title,
      };
    },
  };
}

async function generateTopicEnrichmentOutput(input: {
  apiKey: string;
  model: string;
  prompt: string;
  provider: LlmProviderId;
}): Promise<unknown> {
  const result = await generateText({
    model: getSdkModel(input.provider, input.apiKey),
    output: Output.object({ schema: topicEnrichmentSchema }),
    prompt: input.prompt,
    system:
      "You enrich topic records for a technical knowledge base. Return only the requested structured object.",
    maxOutputTokens: 1200,
    temperature: 0,
  });

  return result.output;
}

function normalizeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

import { generateText, NoOutputGeneratedError, Output } from "ai";
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
import type { TopicApprovalMode } from "./document-vault.ts";
import { getWorkspaceLlmApiKeyForEnrichment } from "./llm-provider-settings.ts";
import {
  getLlmProvider,
  getSdkModel,
  LLM_PROVIDERS,
  type LlmProviderId,
} from "./llm-providers.ts";
import { normalizeOkfArticleBody } from "./okf-article-content.ts";

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
      approvalMode?: TopicApprovalMode;
      approvedAt?: Date;
      approvedBy?: string;
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
  sourcePageMode?: "expanded" | "exact";
};

type ApproveTopicOptions = {
  approvalMode?: TopicApprovalMode;
  approvedAt?: Date;
  approvedBy?: string;
  context?: AuthWorkspaceContext;
  repository?: Pick<TopicEnrichmentRepository, "approveTopicContent">;
};

const ANTHROPIC_PROVIDER = getLlmProvider(LLM_PROVIDERS[0].id);
const OPENAI_PROVIDER = getLlmProvider(LLM_PROVIDERS[1].id);
const COMPACT_RETRY_SOURCE_CHAR_LIMIT = 12_000;
export const TOPIC_ENRICHMENT_MAX_OUTPUT_TOKENS = 3_000;
const topicEnrichmentSchema = z.object({
  body: z.string(),
  proposedSourcePageNumbers: z.array(z.number().int().positive()),
  summary: z.string(),
  title: z.string(),
});

export async function enrichTopic(
  topicId: string,
  options: EnrichTopicOptions = {},
): Promise<TopicRecord> {
  const context = options.context ?? (await requireAuthWorkspaceContext());
  const repository = options.repository ?? createDefaultTopicEnrichmentRepository();
  const enrichmentInput = await repository.getTopicEnrichmentInput({
    context,
    topicId,
  });
  const topic = enrichmentInput.topic;
  const sourcePages = options.sourcePageMode === "exact"
    ? enrichmentInput.sourcePages.filter((page) => topic.sourcePageNumbers.includes(page.pageNumber))
    : enrichmentInput.sourcePages;

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

  const prompt = buildTopicEnrichmentPrompt({
    allowSourcePageProposals: options.sourcePageMode !== "exact",
    sourcePages,
    topic,
  });
  let activePrompt = prompt;
  let attempts = 1;
  try {
    let result: TopicEnrichmentProviderOutput;
    try {
      result = await provider.enrich({
        apiKey: key.apiKey,
        prompt: activePrompt,
        sourcePages,
        summary: topic.summary,
        title: topic.title,
      });
    } catch (error) {
      if (!isMissingStructuredOutput(error)) throw error;
      attempts = 2;
      activePrompt = buildTopicEnrichmentPrompt({
        allowSourcePageProposals: options.sourcePageMode !== "exact",
        compactRetry: true,
        sourcePages,
        topic,
      });
      result = await provider.enrich({
        apiKey: key.apiKey,
        prompt: activePrompt,
        sourcePages,
        summary: topic.summary,
        title: topic.title,
      });
    }
    const enrichedTitle = result.title.trim();
    const enrichedSummary = result.summary.trim();
    const enrichedBodyInput = (result.body ?? result.summary).trim();
    const proposedSourcePageNumbers = [...new Set(result.proposedSourcePageNumbers ?? [])]
      .filter((page) => sourcePages.some((sourcePage) => sourcePage.pageNumber === page))
      .filter((page) => !topic.sourcePageNumbers.includes(page))
      .sort((left, right) => left - right);

    if (!enrichedTitle || !enrichedSummary) {
      throw new Error("llm_enrichment_empty_response");
    }
    const normalizedBody = normalizeOkfArticleBody({
      body: enrichedBodyInput,
      title: enrichedTitle,
    }).body;
    const enrichedBody = normalizedBody || enrichedSummary;

    return repository.completeTopicEnrichment({
      context,
      enrichedSummary,
      enrichedTitle,
      enrichedBody,
      proposedSourcePageNumbers,
      model: provider.model,
      promptSent: activePrompt,
      provider: provider.provider,
      rawResponse: result.rawResponse,
      requestedBy: context.userId,
      topicId,
    });
  } catch (error) {
    return repository.failTopicEnrichment({
      context,
      errorMessage: formatEnrichmentErrorMessage(error, attempts),
      model: provider.model,
      promptSent: activePrompt,
      provider: provider.provider,
      rawResponse: serializeEnrichmentError(error, {
        attempts,
        compactRetryUsed: attempts === 2,
        promptCharacters: activePrompt.length,
      }),
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
    approvalMode: options.approvalMode,
    approvedAt: options.approvedAt,
    approvedBy: options.approvedBy,
    context,
    topicId,
  });
}

export function buildTopicEnrichmentPrompt(input: {
  allowSourcePageProposals?: boolean;
  compactRetry?: boolean;
  sourcePages: ExtractedPageRecord[];
  topic: TopicRecord;
}) {
  const sourcePages = input.compactRetry
    ? compactSourcePages(input.sourcePages, COMPACT_RETRY_SOURCE_CHAR_LIMIT)
    : input.sourcePages;
  const sourceText = sourcePages
    .map((page) => `Page ${page.pageNumber}\n${page.text}`)
    .join("\n\n---\n\n");

  return [
    "You are polishing a draft technical topic for a document knowledge base.",
    "Use only the supplied source text. Do not invent facts, applicability, warnings, or procedures that are not present in the source.",
    "Do not change the technical meaning. Improve clarity, structure, and wording only.",
    "Return strict JSON with title, summary, body, and proposedSourcePageNumbers.",
    "Keep summary concise. Body must be a structured Markdown article grounded only in source text.",
    "The body is an article fragment: do not include a top-level H1 or repeat the title.",
    "Do not restate the summary as the opening paragraph, and do not add a Source, Sources, References, or provenance section.",
    input.compactRetry
      ? "This is a bounded retry using compact source excerpts. Return a complete concise article rather than an exhaustive response."
      : null,
    input.allowSourcePageProposals === false
      ? "Use only the established source pages and return an empty proposedSourcePageNumbers array."
      : "Only propose page numbers from the supplied source context; proposals require reviewer acceptance.",
    "",
    `Current title: ${input.topic.title}`,
    `Current summary: ${input.topic.summary}`,
    "",
    "Source text:",
    sourceText || "No source text was available for this topic.",
  ].filter((line): line is string => line !== null).join("\n");
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
      approveTopicContent(input.topicId, input.approvedContentSource, {
        approvalMode: input.approvalMode,
        approvedAt: input.approvedAt,
        approvedBy: input.approvedBy,
      }),
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
    maxOutputTokens: TOPIC_ENRICHMENT_MAX_OUTPUT_TOKENS,
    temperature: 0,
  });

  return result.output;
}

function normalizeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isMissingStructuredOutput(error: unknown) {
  return NoOutputGeneratedError.isInstance(error) ||
    normalizeErrorMessage(error) === "No output generated.";
}

function formatEnrichmentErrorMessage(error: unknown, attempts: number) {
  if (isMissingStructuredOutput(error)) {
    return attempts > 1
      ? "The model did not return a complete structured topic after two attempts."
      : "The model did not return a complete structured topic.";
  }
  return normalizeErrorMessage(error);
}

function serializeEnrichmentError(
  error: unknown,
  context: { attempts: number; compactRetryUsed: boolean; promptCharacters: number },
) {
  const details: Record<string, unknown> = {
    ...context,
    message: normalizeErrorMessage(error),
    name: error instanceof Error ? error.name : "UnknownError",
  };
  if (error instanceof Error && error.cause) {
    details.cause = error.cause instanceof Error
      ? { message: error.cause.message, name: error.cause.name }
      : String(error.cause);
  }
  return JSON.stringify(details);
}

function compactSourcePages(pages: ExtractedPageRecord[], limit: number) {
  if (pages.length === 0) return pages;
  const perPageLimit = Math.max(400, Math.floor(limit / pages.length));
  return pages.map((page) => ({
    ...page,
    text: compactSourceText(page.text, perPageLimit),
  }));
}

function compactSourceText(value: string, limit: number) {
  if (value.length <= limit) return value;
  const headLength = Math.floor(limit * 0.7);
  const tailLength = limit - headLength;
  return `${value.slice(0, headLength).trimEnd()}\n[...source excerpt shortened...]\n${value.slice(-tailLength).trimStart()}`;
}

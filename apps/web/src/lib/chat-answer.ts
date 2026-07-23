import { generateText, Output } from "ai";
import { z } from "zod";

import { parseCitationMarkers } from "./chat-citation-markers.ts";
import {
  buildRetrievalAnswer,
  type ChatRetrievalEvidence,
  type RetrievalAnswerInput,
} from "./chat-retrieval.ts";
import type {
  ChatContextAssumption,
  RetrievalChatRoute,
} from "./chat-router.ts";
import { getWorkspaceLlmApiKeyForEnrichment } from "./llm-provider-settings.ts";
import {
  getLlmProvider,
  getSdkModel,
  type LlmProviderId,
} from "./llm-providers.ts";

const ANSWER_MAX_TOKENS = 1024;

export type ChatAnswer = {
  content: string;
  mode: "llm" | "deterministic";
  model?: string;
  outcome: "answered" | "insufficient_evidence" | "retrieval_unavailable";
  provider?: LlmProviderId;
};

export function discloseChatAssumptions(
  content: string,
  assumptions: ChatContextAssumption[],
): string {
  if (assumptions.length === 0) {
    return content;
  }

  const details = assumptions
    .map(
      (assumption) =>
        `${formatContextField(assumption.field)}: ${assumption.value}`,
    )
    .join("; ");

  return `Assumptions used for this search: ${details}. Correct any of these details if they do not apply.\n\n${content}`;
}

function formatContextField(field: ChatContextAssumption["field"]): string {
  return field.replaceAll("_", " ");
}

export type ChatAnswerProviderFn = (input: {
  apiKey: string;
  model: string;
  prompt: string;
  provider: LlmProviderId;
}) => Promise<unknown>;

type GenerateChatAnswerOptions = {
  callProvider?: ChatAnswerProviderFn;
  getApiKey?: (
    workspaceId: string,
  ) => Promise<{ apiKey: string; provider: LlmProviderId } | null>;
};

export async function generateChatAnswer(
  input: {
    evidence: ChatRetrievalEvidence[];
    query: string;
    retrieval: RetrievalAnswerInput;
    route: RetrievalChatRoute;
    workspaceId: string;
  },
  options: GenerateChatAnswerOptions = {},
): Promise<ChatAnswer> {
  const deterministic: ChatAnswer = {
    content: buildRetrievalAnswer(input.route, input.retrieval),
    mode: "deterministic",
    outcome: input.retrieval.retrievalError
      ? "retrieval_unavailable"
      : input.retrieval.citations.length === 0
        ? "insufficient_evidence"
        : "answered",
  };

  // Only synthesize when there is real evidence to ground the answer in;
  // error and missing-evidence replies stay deterministic by design.
  if (input.retrieval.retrievalError || input.retrieval.citations.length === 0) {
    return deterministic;
  }

  const getApiKey = options.getApiKey ?? getWorkspaceLlmApiKeyForEnrichment;
  let key: { apiKey: string; provider: LlmProviderId } | null;
  try {
    key = await getApiKey(input.workspaceId);
  } catch (error) {
    console.error("chat_answer_api_key_lookup_failed", error);
    return deterministic;
  }

  if (!key) {
    return deterministic;
  }

  const provider = getLlmProvider(key.provider);
  const callProvider = options.callProvider ?? callChatAnswerProvider;
  const prompt = buildChatAnswerPrompt({
    crossBundleConflict: input.retrieval.crossBundleConflict,
    evidence: input.evidence,
    query: input.query,
    ragDiscovery: input.retrieval.ragUsedForDiscoveryOnly === true,
    route: input.route,
  });

  try {
    const structuredOutput = await callProvider({
      apiKey: key.apiKey,
      model: provider.model,
      prompt,
      provider: provider.id,
    });
    const payload = parseAnswerPayload(structuredOutput);

    if (!payload.supported) {
      return {
        content: buildNotDirectlyAnsweredReply(input.route),
        mode: "llm",
        model: provider.model,
        outcome: "insufficient_evidence",
        provider: provider.id,
      };
    }

    const answer = payload.answer.trim();

    if (
      !answer ||
      !hasValidCitationMarkers(answer, input.retrieval.citations.length)
    ) {
      // An uncited or miscited synthesis is worse than the citation echo:
      // the echo can only quote real evidence, so fall back rather than
      // risk presenting unverifiable prose.
      return deterministic;
    }

    return {
      content: answer,
      mode: "llm",
      model: provider.model,
      outcome: "answered",
      provider: provider.id,
    };
  } catch (error) {
    console.error("chat_answer_synthesis_failed", error);
    return deterministic;
  }
}

export function buildChatAnswerPrompt(input: {
  crossBundleConflict?: {
    detected: boolean;
    bundleIds: string[];
    conflictingValues: string[];
  };
  evidence: ChatRetrievalEvidence[];
  query: string;
  ragDiscovery?: boolean;
  route: RetrievalChatRoute;
}): string {
  const evidenceBlocks = input.evidence.map((item) => {
    const pages =
      item.pageStart === item.pageEnd
        ? `page ${item.pageStart}`
        : `pages ${item.pageStart}-${item.pageEnd}`;
    const sourceLabel =
      item.sourceType === "okf" ? "approved knowledge" : "raw document text";

    const bundle = item.knowledgeBundleName
      ? `, bundle: ${item.knowledgeBundleName}`
      : "";
    return `[${item.index}] ${item.documentTitle} (${pages}, ${sourceLabel}${bundle})\n${item.text}`;
  });

  return [
    "You answer questions from a mixed-domain document knowledge base.",
    "Rules:",
    "- Use ONLY the numbered evidence excerpts below. Do not use outside knowledge.",
    "- Every sentence that states a fact must end with inline bracketed evidence markers like [1] or [2][3].",
    "- An answer containing no [n] markers is invalid and will be rejected.",
    "- Never cite a number that is not in the evidence list.",
    "- Preserve exact names, dates, versions, citations, identifiers, values, limits, and source wording from the evidence.",
    "- Be concise: a short direct answer first, then supporting detail only if needed.",
    ...(input.crossBundleConflict?.detected
      ? [
          "- Approved sources from different bundles contain conflicting exact values. Present each bundle's position separately and do not choose or merge a value.",
        ]
      : []),
    '- If the evidence does not directly answer the question, return {"answer": "", "supported": false}.',
    'Return strict JSON: {"answer": string, "supported": boolean}',
    'Example: {"answer": "The refund window is 14 days [1]. Requests are handled by support [2].", "supported": true}',
    "",
    `Question: ${input.query}`,
    input.ragDiscovery
      ? "No approved knowledge matched this question. All evidence is raw indexed document text that has not been human-reviewed: present the answer as unreviewed discovery from the documents, never as official or approved guidance."
      : evidenceContextForRoute(input.route),
    "",
    "Evidence:",
    evidenceBlocks.join("\n\n"),
  ].join("\n");
}

export function hasValidCitationMarkers(
  content: string,
  citationCount: number,
): boolean {
  const markers = parseCitationMarkers(content).filter(
    (segment) => segment.type === "citation",
  );

  return (
    markers.length > 0 &&
    markers.every(
      (segment) =>
        segment.type === "citation" &&
        segment.index >= 1 &&
        segment.index <= citationCount,
    )
  );
}

export function buildNotDirectlyAnsweredReply(route: RetrievalChatRoute): string {
  const searched = route === "okf_only"
    ? "the approved knowledge bundle and its raw document fallback"
    : route === "rag_only"
      ? "the indexed source documents"
      : "the approved knowledge bundle and indexed source documents";
  return `I found related material, but not enough supported evidence to answer this question reliably. I searched ${searched}. Next, name the specific document, subject, version, or scope you mean, or add and review a source that covers the missing information.`;
}

function evidenceContextForRoute(route: RetrievalChatRoute): string {
  if (route === "okf_only") {
    return "All evidence comes from the human-approved knowledge base.";
  }

  if (route === "rag_only") {
    return "All evidence comes from raw indexed document text that has not necessarily been human-reviewed.";
  }

  return "Evidence entries are labeled approved knowledge or raw document text. If they conflict, prefer approved knowledge and say the raw text disagrees.";
}

const chatAnswerSchema = z.object({
  answer: z.string(),
  supported: z.boolean(),
});

function parseAnswerPayload(rawOutput: unknown): {
  answer: string;
  supported: boolean;
} {
  const parsed = chatAnswerSchema.safeParse(rawOutput);

  if (!parsed.success) {
    throw new Error("chat_answer_malformed_response");
  }

  return parsed.data;
}

async function callChatAnswerProvider(input: {
  apiKey: string;
  model: string;
  prompt: string;
  provider: LlmProviderId;
}): Promise<unknown> {
  const result = await generateText({
    model: getSdkModel(input.provider, input.apiKey),
    output: Output.object({ schema: chatAnswerSchema }),
    prompt: input.prompt,
    system:
      "You answer questions strictly from supplied evidence. Return only the requested structured object.",
    maxOutputTokens: ANSWER_MAX_TOKENS,
    temperature: 0,
  });

  return result.output;
}

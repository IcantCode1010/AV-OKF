import { generateText, Output } from "ai";
import { z } from "zod";

import { getWorkspaceLlmApiKeyForEnrichment } from "./llm-provider-settings.ts";
import { getLlmProvider, getSdkModel, type LlmProviderId } from "./llm-providers.ts";
import { getPrisma } from "./prisma.ts";
import type { RetrievalResult } from "./rag-types.ts";

export type RagRerankStatus =
  | "applied"
  | "not_applicable"
  | "no_candidates"
  | "missing_key"
  | "budget_exceeded"
  | "provider_failed"
  | "malformed_response";

export type RagRerankTrace = {
  applied: boolean;
  diagnostic?: "duplicate_alias" | "invalid_score" | "missing_alias" | "schema_invalid" | "unknown_alias";
  dropped: number;
  model?: string;
  provider?: string;
  status: RagRerankStatus;
};

const scoreSchema = z.object({
  alias: z.string(),
  reason: z.string().max(160),
  relevance: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
});
const responseSchema = z.object({ scores: z.array(scoreSchema) });

export async function rerankRawRagCandidates(
  input: { candidates: RetrievalResult[]; query: string; workspaceId: string },
  options: {
    callProvider?: (input: { apiKey: string; candidates: Array<{ alias: string; excerpt: string }>; model: string; provider: LlmProviderId; query: string }) => Promise<unknown>;
    getApiKey?: typeof getWorkspaceLlmApiKeyForEnrichment;
    reserveCall?: (workspaceId: string) => Promise<boolean>;
  } = {},
): Promise<{ results: RetrievalResult[]; trace: RagRerankTrace }> {
  if (input.candidates.length === 0) return { results: [], trace: baseTrace("no_candidates") };
  let key;
  try {
    key = await (options.getApiKey ?? getWorkspaceLlmApiKeyForEnrichment)(input.workspaceId);
  } catch {
    return failOpen(input.candidates, "missing_key");
  }
  if (!key) return failOpen(input.candidates, "missing_key");
  if (!(await (options.reserveCall ?? reserveRerankCall)(input.workspaceId))) {
    return failOpen(input.candidates, "budget_exceeded");
  }
  const provider = getLlmProvider(key.provider);
  const providerCandidates = input.candidates.map((candidate, index) => ({
    alias: `c${index + 1}`,
    excerpt: truncate(candidate.text),
  }));
  let raw: unknown;
  try {
    raw = await (options.callProvider ?? callRerankProvider)({
      apiKey: key.apiKey,
      candidates: providerCandidates,
      model: provider.model,
      provider: key.provider,
      query: input.query,
    });
  } catch {
    return failOpen(input.candidates, "provider_failed", provider.id, provider.model);
  }
  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success) {
    logMalformedResponse({
      candidateCount: input.candidates.length,
      diagnostic: "schema_invalid",
      model: provider.model,
      provider: provider.id,
    });
    return failOpen(
      input.candidates,
      "malformed_response",
      provider.id,
      provider.model,
      "schema_invalid",
    );
  }
  const diagnostic = validateScoreSet(
    parsed.data.scores,
    providerCandidates.map((item) => item.alias),
  );
  if (diagnostic) {
    logMalformedResponse({
      candidateCount: input.candidates.length,
      diagnostic,
      model: provider.model,
      provider: provider.id,
    });
    return failOpen(
      input.candidates,
      "malformed_response",
      provider.id,
      provider.model,
      diagnostic,
    );
  }
  const scoreByAlias = new Map(parsed.data.scores.map((score) => [score.alias, score.relevance]));
  const results = input.candidates
    .map((candidate, rank) => ({ candidate, rank, relevance: scoreByAlias.get(`c${rank + 1}`)! }))
    .filter((item) => item.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance || a.rank - b.rank)
    .map((item) => item.candidate);
  return {
    results,
    trace: { applied: true, dropped: input.candidates.length - results.length, model: provider.model, provider: provider.id, status: "applied" },
  };
}

async function callRerankProvider(input: { apiKey: string; candidates: Array<{ alias: string; excerpt: string }>; model: string; provider: LlmProviderId; query: string }) {
  const result = await generateText({
    model: getSdkModel(input.provider, input.apiKey),
    output: Output.object({ schema: responseSchema }),
    prompt: JSON.stringify({
      query: input.query,
      chunks: input.candidates,
    }),
    system: "Score every supplied chunk alias exactly once for whether it directly helps answer the query. Use relevance 0 (irrelevant) through 3 (directly answer-bearing). Never create aliases. Keep each reason under 160 characters.",
    maxOutputTokens: 1_000,
    temperature: 0,
  });
  return result.output;
}

async function reserveRerankCall(workspaceId: string) {
  const cap = readCallCap();
  const usageDate = new Date().toISOString().slice(0, 10);
  return getPrisma().$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(2147483002, hashtext(${workspaceId}))`;
    const current = await tx.ragRerankDailyUsage.findUnique({ where: { workspaceId_usageDate: { usageDate, workspaceId } } });
    if ((current?.calls ?? 0) >= cap) return false;
    await tx.ragRerankDailyUsage.upsert({
      create: { calls: 1, usageDate, workspaceId },
      update: { calls: { increment: 1 } },
      where: { workspaceId_usageDate: { usageDate, workspaceId } },
    });
    return true;
  });
}

function validateScoreSet(
  scores: Array<{ alias: string; relevance: number }>,
  aliases: string[],
): RagRerankTrace["diagnostic"] | undefined {
  const expected = new Set(aliases);
  const actual = new Set(scores.map((score) => score.alias));
  if (actual.size !== scores.length) return "duplicate_alias";
  if ([...actual].some((alias) => !expected.has(alias))) return "unknown_alias";
  if (scores.length !== aliases.length || aliases.some((alias) => !actual.has(alias))) {
    return "missing_alias";
  }
  if (scores.some((score) => !Number.isInteger(score.relevance) || score.relevance < 0 || score.relevance > 3)) {
    return "invalid_score";
  }
  return undefined;
}

function truncate(text: string) {
  const words = text.trim().split(/\s+/);
  return words.slice(0, 300).join(" ");
}

function logMalformedResponse(input: {
  candidateCount: number;
  diagnostic: NonNullable<RagRerankTrace["diagnostic"]>;
  model: string;
  provider: string;
}) {
  console.error("rag_rerank_malformed_response", input);
}

function readCallCap() {
  const value = Number(process.env.RAG_RERANK_MAX_CALLS_PER_WORKSPACE_DAY ?? 200);
  if (!Number.isInteger(value) || value < 0) throw new Error("invalid_env_RAG_RERANK_MAX_CALLS_PER_WORKSPACE_DAY");
  return value;
}

function baseTrace(status: RagRerankStatus): RagRerankTrace {
  return { applied: false, dropped: 0, status };
}

function failOpen(
  results: RetrievalResult[],
  status: RagRerankStatus,
  provider?: string,
  model?: string,
  diagnostic?: RagRerankTrace["diagnostic"],
) {
  return { results, trace: { ...baseTrace(status), ...(provider ? { provider } : {}), ...(model ? { model } : {}), ...(diagnostic ? { diagnostic } : {}) } };
}

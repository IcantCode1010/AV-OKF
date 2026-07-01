export class EmbeddingBudgetExceededError extends Error {
  code = "embedding_budget_exceeded" as const;

  constructor(message: string) {
    super(`embedding_budget_exceeded: ${message}`);
    this.name = "EmbeddingBudgetExceededError";
  }
}

export type EmbeddingBudgetInput = {
  documentTokenEstimate: number;
  globalTokensUsedToday: number;
  workspaceTokensUsedToday: number;
};

export type EmbeddingBudgetCaps = {
  globalTokensPerDay: number;
  tokensPerDocument: number;
  workspaceTokensPerDay: number;
};

export function getEmbeddingBudgetCaps(): EmbeddingBudgetCaps {
  return {
    globalTokensPerDay: numberEnv(
      "RAG_EMBEDDING_MAX_TOKENS_GLOBAL_DAY",
      5_000_000,
    ),
    tokensPerDocument: numberEnv(
      "RAG_EMBEDDING_MAX_TOKENS_PER_DOCUMENT",
      250_000,
    ),
    workspaceTokensPerDay: numberEnv(
      "RAG_EMBEDDING_MAX_TOKENS_PER_WORKSPACE_DAY",
      1_000_000,
    ),
  };
}

export function assertEmbeddingBudget(
  input: EmbeddingBudgetInput,
  caps = getEmbeddingBudgetCaps(),
): void {
  if (input.documentTokenEstimate > caps.tokensPerDocument) {
    throw new EmbeddingBudgetExceededError(
      `Document requires ${input.documentTokenEstimate} embedding tokens, exceeding per-document cap of ${caps.tokensPerDocument}.`,
    );
  }

  if (
    input.workspaceTokensUsedToday + input.documentTokenEstimate >
    caps.workspaceTokensPerDay
  ) {
    throw new EmbeddingBudgetExceededError(
      `Workspace has ${input.workspaceTokensUsedToday} tokens indexed today; this job requires ${input.documentTokenEstimate} and would exceed daily cap of ${caps.workspaceTokensPerDay}.`,
    );
  }

  if (
    input.globalTokensUsedToday + input.documentTokenEstimate >
    caps.globalTokensPerDay
  ) {
    throw new EmbeddingBudgetExceededError("Global daily embedding cap exceeded.");
  }
}

function numberEnv(key: string, fallback: number) {
  const value = process.env[key];

  if (!value) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`invalid_env_${key}`);
  }

  return parsed;
}

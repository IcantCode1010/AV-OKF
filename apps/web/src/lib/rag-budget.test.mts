import assert from "node:assert/strict";
import test from "node:test";

import { assertEmbeddingBudget } from "./rag-budget.ts";

test("assertEmbeddingBudget fails before provider call when document cap is exceeded", () => {
  assert.throws(
    () =>
      assertEmbeddingBudget({
        documentTokenEstimate: 250_001,
        globalTokensUsedToday: 0,
        workspaceTokensUsedToday: 0,
      }),
    /embedding_budget_exceeded/,
  );
});

test("assertEmbeddingBudget fails when workspace daily cap would be exceeded", () => {
  assert.throws(
    () =>
      assertEmbeddingBudget({
        documentTokenEstimate: 90_000,
        globalTokensUsedToday: 0,
        workspaceTokensUsedToday: 940_000,
      }),
    /Workspace has 940000 tokens indexed today/,
  );
});

test("assertEmbeddingBudget allows requests under all caps", () => {
  assert.doesNotThrow(() =>
    assertEmbeddingBudget({
      documentTokenEstimate: 1_000,
      globalTokensUsedToday: 2_000,
      workspaceTokensUsedToday: 3_000,
    }),
  );
});

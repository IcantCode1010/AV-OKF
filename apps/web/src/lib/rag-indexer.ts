import { UnrecoverableError } from "bullmq";

import {
  EmbeddingBudgetExceededError,
  assertEmbeddingBudget,
  type EmbeddingBudgetCaps,
} from "./rag-budget.ts";
import { chunkExtractedPages } from "./rag-chunker.ts";
import {
  getEmbeddingProvider,
  type EmbeddingProvider,
} from "./embedding-provider.ts";
import { createRagRepository, type RagRepository } from "./rag-repository.ts";
import type { RagIndexJobPayload } from "./rag-queue.ts";
import type { ExtractedPageRecord } from "./document-vault.ts";
import type { RagChunkInput, RagChunkRecord } from "./rag-types.ts";

type RunRagIndexJobOptions = {
  budgetCaps?: EmbeddingBudgetCaps;
  chunkPages?: (input: RagChunkInput) => RagChunkRecord[];
  embeddingProvider?: EmbeddingProvider;
  repository?: Pick<
    RagRepository,
    | "failIndexJob"
    | "getExtractedPages"
    | "getTokenUsageToday"
    | "markIndexJobRunning"
    | "storeCompletedIndex"
  > & {
    reserveIndexJobBudget?: (input: {
      caps?: EmbeddingBudgetCaps;
      indexJobId: string;
      tokenEstimate: number;
      workspaceId: string;
    }) => Promise<void>;
  };
};

export async function runRagIndexJob(
  payload: RagIndexJobPayload,
  options: RunRagIndexJobOptions = {},
) {
  const repository = options.repository ?? createRagRepository();
  const embeddingProvider = options.embeddingProvider ?? getEmbeddingProvider();
  const chunkPages = options.chunkPages ?? chunkExtractedPages;

  try {
    const pages = (await repository.getExtractedPages(
      payload,
    )) as ExtractedPageRecord[];
    const chunks = chunkPages({
      documentId: payload.documentId,
      indexJobId: payload.indexJobId,
      indexVersion: payload.indexVersion,
      pages,
      workspaceId: payload.workspaceId,
    });
    const tokenEstimate = chunks.reduce(
      (sum, chunk) => sum + chunk.tokenCount,
      0,
    );
    if (repository.reserveIndexJobBudget) {
      await repository.reserveIndexJobBudget({
        caps: options.budgetCaps,
        indexJobId: payload.indexJobId,
        tokenEstimate,
        workspaceId: payload.workspaceId,
      });
    } else {
      const usage = await repository.getTokenUsageToday({
        workspaceId: payload.workspaceId,
      });

      assertEmbeddingBudget(
        {
          documentTokenEstimate: tokenEstimate,
          globalTokensUsedToday: usage.globalTokensUsedToday,
          workspaceTokensUsedToday: usage.workspaceTokensUsedToday,
        },
        options.budgetCaps,
      );

      await repository.markIndexJobRunning({
        indexJobId: payload.indexJobId,
        tokenEstimate,
      });
    }

    const embeddings =
      chunks.length > 0
        ? await embeddingProvider.embedTexts(chunks.map((chunk) => chunk.text))
        : [];

    await repository.storeCompletedIndex({
      chunks,
      documentId: payload.documentId,
      embeddings,
      indexJobId: payload.indexJobId,
      indexVersion: payload.indexVersion,
      model: embeddingProvider.model,
      workspaceId: payload.workspaceId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isBudgetFailure = error instanceof EmbeddingBudgetExceededError;

    await repository.failIndexJob({
      documentId: payload.documentId,
      errorCode: isBudgetFailure
        ? "embedding_budget_exceeded"
        : "indexing_failed",
      errorMessage: message,
      indexJobId: payload.indexJobId,
    });

    if (isBudgetFailure) {
      throw new UnrecoverableError(message);
    }

    throw error;
  }
}

import { getEmbeddingProvider } from "./embedding-provider.ts";
import { createRagRepository } from "./rag-repository.ts";
import { reciprocalRankFusion } from "./rag-retrieval.ts";
import type { RetrievalRequest, RetrievalResult } from "./rag-types.ts";

type VectorSearchRepository = ReturnType<typeof createRagRepository> & {
  searchVector?(input: RetrievalRequest & { embedding: number[] }): Promise<
    RetrievalResult[]
  >;
};

export async function retrieveDocuments(
  request: RetrievalRequest,
): Promise<RetrievalResult[]> {
  const repository = createRagRepository();

  if (request.mode === "keyword") {
    return repository.searchKeyword(request);
  }

  const provider = getEmbeddingProvider();
  const [queryEmbedding] = await provider.embedTexts([request.query]);

  if (!queryEmbedding) {
    return [];
  }

  if (request.mode === "vector") {
    return searchVector(repository, request, queryEmbedding);
  }

  const [keywordResults, vectorResults] = await Promise.all([
    repository.searchKeyword(request),
    searchVector(repository, request, queryEmbedding),
  ]);

  return mergeHybridResults(keywordResults, vectorResults, request.topK);
}

async function searchVector(
  repository: VectorSearchRepository,
  request: RetrievalRequest,
  embedding: number[],
): Promise<RetrievalResult[]> {
  if (typeof repository.searchVector === "function") {
    return repository.searchVector({ ...request, embedding });
  }

  return [];
}

function mergeHybridResults(
  keywordResults: RetrievalResult[],
  vectorResults: RetrievalResult[],
  topK: number,
): RetrievalResult[] {
  const byChunk = new Map<string, RetrievalResult>();

  for (const result of [...keywordResults, ...vectorResults]) {
    const existing = byChunk.get(result.chunkId);
    byChunk.set(
      result.chunkId,
      existing && existing.score > result.score ? existing : result,
    );
  }

  const fused = reciprocalRankFusion([
    keywordResults.map((result) => ({
      chunkId: result.chunkId,
      score: result.score,
    })),
    vectorResults.map((result) => ({
      chunkId: result.chunkId,
      score: result.score,
    })),
  ]);

  return fused
    .map((result) => byChunk.get(result.chunkId))
    .filter((result): result is RetrievalResult => Boolean(result))
    .slice(0, topK)
    .map((result) => ({ ...result, retrievalMode: "hybrid" }));
}

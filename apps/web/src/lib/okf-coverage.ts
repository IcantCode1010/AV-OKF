import { createRagRepository, type RagRepository } from "./rag-repository.ts";

export const OKF_COVERAGE_TYPE_DIRECT_SOURCE = "direct_source";

export type OkfCoverageRepository = Pick<
  RagRepository,
  "listActiveChunksForDocument" | "syncOkfConceptChunkLinks"
>;

export type OkfCoverageResolution = {
  chunkIds: string[];
  coverageType: string;
};

export async function resolveOkfCoverage(input: {
  documentId: string;
  repository?: OkfCoverageRepository;
  sourcePageNumbers: number[];
  workspaceId: string;
}): Promise<OkfCoverageResolution> {
  const repository = input.repository ?? createRagRepository();
  const pageNumbers = new Set(input.sourcePageNumbers);
  const chunks = await repository.listActiveChunksForDocument({
    documentId: input.documentId,
    workspaceId: input.workspaceId,
  });

  const chunkIds = chunks
    .filter((chunk) =>
      chunk.sourcePageNumbers.some((page) => pageNumbers.has(page)),
    )
    .map((chunk) => chunk.id)
    .sort();

  return {
    chunkIds,
    coverageType: OKF_COVERAGE_TYPE_DIRECT_SOURCE,
  };
}

export async function syncOkfConceptCoverage(input: {
  chunkIds: string[];
  coverageType: string;
  knowledgeBundleId?: string;
  okfConceptId: string;
  repository?: OkfCoverageRepository;
  workspaceId: string;
}): Promise<void> {
  const repository = input.repository ?? createRagRepository();

  await repository.syncOkfConceptChunkLinks({
    chunkIds: input.chunkIds,
    coverageType: input.coverageType,
    ...(input.knowledgeBundleId ? { knowledgeBundleId: input.knowledgeBundleId } : {}),
    okfConceptId: input.okfConceptId,
    workspaceId: input.workspaceId,
  });
}

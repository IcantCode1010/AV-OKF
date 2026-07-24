import {
  isRetrievalRoute,
  type ChatEvidenceStatus,
  type ChatRoute,
  type ChatRouterDecision,
} from "./chat-router.ts";
import type { ChatCitation } from "./chat-types.ts";
import {
  retrieveOkfBundleEvidenceWithDiagnostics,
  type MetadataClarification,
  type OkfBundleEvidence,
  type OkfBundleRetrievalDiagnostics,
} from "./okf-bundle-retriever.ts";
import {
  traverseOkfRelations,
  type OkfGraphTraversalResult,
} from "./okf-graph-retriever.ts";
import { createPostgresOkfConceptLifecycleLookup } from "./okf-lifecycle.ts";
import { retrieveDocuments, retrieveDocumentsByChunkIds } from "./rag-backend.ts";
import type { RetrievalResult } from "./rag-types.ts";
import {
  getKnowledgeBundleByIdentity,
  resolveKnowledgeBundleRoot,
} from "./knowledge-bundles.ts";
import { readOkfBundleFile } from "./okf-bundle.ts";
import { rerankRawRagCandidates, type RagRerankTrace } from "./rag-reranker.ts";
import { getPrisma } from "./prisma.ts";
import {
  createAgentToolExecutor,
  type AgentExecutionTrace,
} from "./agent-tools.ts";

const OKF_TOP_K = 4;
const RAG_TOP_K = 6;
const CITATION_EXCERPT_MAX_CHARS = 240;
// Evidence excerpts feed the LLM answer builder, so they carry much more of
// the chunk than the short persisted/rendered citation excerpts do.
const EVIDENCE_EXCERPT_MAX_CHARS = 1500;

// Fuller-text counterpart to a ChatCitation, keyed by the same index. Used
// only to prompt the answer builder; never persisted or rendered.
export type ChatRetrievalEvidence = {
  approvalProvenance?: "automated" | "human" | "legacy";
  knowledgeBundleId?: string;
  knowledgeBundleName?: string;
  documentTitle: string;
  index: number;
  okfEvidenceMode?: "direct" | "graph";
  okfFilePath?: string;
  pageEnd: number;
  pageStart: number;
  sourceFile?: string;
  sourceType: "okf" | "rag";
  text: string;
};

export type ChatRetrievalResult = {
  agentExecution?: AgentExecutionTrace;
  // True when approved OKF evidence was retrieved for this answer
  // (query-router.md trace field whether_approved_okf_was_available).
  approvedOkfAvailable: boolean;
  citations: ChatCitation[];
  evidence: ChatRetrievalEvidence[];
  // True when the citations are unreviewed RAG content standing in as
  // discovery, either a rag_only answer or an OKF route downgraded because
  // no approved evidence existed. Never true when OKF evidence is present.
  ragUsedForDiscoveryOnly: boolean;
  okfEvidenceMode?: "direct" | "graph";
  okfMatchMode?: "lexical" | "vector";
  metadataClarification?: MetadataClarification;
  rerank: RagRerankTrace;
  retrievalError: boolean;
  retrievalToolsCalled: string[];
  searchSummary?: ChatSearchSummary;
  sourcesRead: string[];
  crossBundleConflict?: {
    detected: boolean;
    bundleIds: string[];
    conflictingValues: string[];
  };
};

export type ChatSearchSummary = {
  approvedKnowledgeMatches: number;
  bundlesSearched: number;
  indexedDocumentsSearched: number;
};

export type ChatRetrievalFn = (input: {
  decision: ChatRouterDecision;
  clarificationAlreadyAsked?: boolean;
  includeSearchSummary?: boolean;
  knowledgeBundleId?: string;
  knowledgeBundleIds?: string[];
  query: string;
  workspaceId: string;
}) => Promise<ChatRetrievalResult>;

export type OkfBundleRetrievalFn = (input: {
  knowledgeBundleId?: string;
  query: string;
  topK: number;
  workspaceId: string;
}) => Promise<OkfBundleEvidence[] | OkfBundleRetrievalDiagnostics>;

export type OkfGraphTraversalFn = (input: {
  knowledgeBundleId?: string;
  seedFiles: string[];
  workspaceId: string;
  maxHops?: number;
}) => Promise<OkfGraphTraversalResult>;

export type CoveredRagRetrievalFn = (input: {
  chunkIds: string[];
  knowledgeBundleId?: string;
  topK: number;
  workspaceId: string;
}) => Promise<RetrievalResult[]>;

export type ChatScopeBundle = {
  description: string;
  id: string;
  indexContent: string;
  name: string;
};

export type ChatScopeBundleResolver = (input: {
  bundleIds: string[];
  workspaceId: string;
}) => Promise<ChatScopeBundle[]>;

async function retrieveOkfBundleDiagnosticsWithLifecycle(input: {
  knowledgeBundleId?: string;
  query: string;
  topK: number;
  workspaceId: string;
}): Promise<OkfBundleRetrievalDiagnostics> {
  const knowledgeBundleId = input.knowledgeBundleId ?? "kb_general_local";
  const bundle = await getKnowledgeBundleByIdentity({
    bundleId: knowledgeBundleId,
    workspaceId: input.workspaceId,
  });
  if (!bundle) {
    return { nearMissCandidates: [], qualifiedEvidence: [] };
  }

  return retrieveOkfBundleEvidenceWithDiagnostics({
    ...input,
    bundleName: bundle.name,
    clarificationFields: bundle.profile.clarificationFields,
    knowledgeBundleId,
    knowledgeRoot: resolveKnowledgeBundleRoot({
      bundleId: knowledgeBundleId,
      workspaceId: input.workspaceId,
    }),
    lifecycleLookup: createPostgresOkfConceptLifecycleLookup(),
  });
}

async function traverseOkfRelationsWithLifecycle(input: {
  knowledgeBundleId?: string;
  seedFiles: string[];
  workspaceId: string;
  maxHops?: number;
}): Promise<OkfGraphTraversalResult> {
  const knowledgeBundleId = input.knowledgeBundleId ?? "kb_general_local";

  return traverseOkfRelations({
    ...input,
    knowledgeBundleId,
    knowledgeRoot: resolveKnowledgeBundleRoot({
      bundleId: knowledgeBundleId,
      workspaceId: input.workspaceId,
    }),
    lifecycleLookup: createPostgresOkfConceptLifecycleLookup(),
  });
}

export async function runChatRetrieval(
  input: {
    clarificationAlreadyAsked?: boolean;
    decision: ChatRouterDecision;
    deferRawRagFallback?: boolean;
    includeSearchSummary?: boolean;
    knowledgeBundleId?: string;
    knowledgeBundleIds?: string[];
    query: string;
    workspaceId: string;
  },
  retrieve: typeof retrieveDocuments = retrieveDocuments,
  retrieveOkf: OkfBundleRetrievalFn = retrieveOkfBundleDiagnosticsWithLifecycle,
  traverseGraph: OkfGraphTraversalFn = traverseOkfRelationsWithLifecycle,
  retrieveCoveredRag: CoveredRagRetrievalFn = retrieveDocumentsByChunkIds,
  rerank: typeof rerankRawRagCandidates = rerankRawRagCandidates,
  resolveScopeBundles: ChatScopeBundleResolver = resolveActiveScopeBundles,
): Promise<ChatRetrievalResult> {
  // Preserve the direct single-bundle facade for existing callers and
  // injected tests. Production multi-bundle chat supplies knowledgeBundleIds
  // and takes the ranked live-registry path below.
  if (
    input.knowledgeBundleId &&
    (!input.knowledgeBundleIds || input.knowledgeBundleIds.length === 0)
  ) {
    return runSingleBundleChatRetrieval(
      { ...input, knowledgeBundleIds: undefined },
      retrieve,
      retrieveOkf,
      traverseGraph,
      retrieveCoveredRag,
      rerank,
    );
  }

  const bundleIds = normalizeBundleScope(input);
  const activeBundles = await resolveScopeBundles({
    bundleIds,
    workspaceId: input.workspaceId,
  });
  const positions = new Map(bundleIds.map((bundleId, position) => [bundleId, position]));
  const rankedBundles = activeBundles
    .filter((bundle) => positions.has(bundle.id))
    .map((bundle) => ({
      bundle,
      bundleId: bundle.id,
      position: positions.get(bundle.id)!,
      score: scoreBundleForQuery(
        input.query,
        `${bundle.name} ${bundle.description} ${bundle.indexContent}`,
      ),
    }))
    .sort((left, right) => right.score - left.score || left.position - right.position);
  const results: Array<{ bundleId: string; bundleName: string; result: ChatRetrievalResult }> =
    [];

  for (let index = 0; index < rankedBundles.length; index += 2) {
    const batch = rankedBundles.slice(index, index + 2);
    const batchResults = await Promise.all(
      batch.map(async ({ bundle, bundleId }) => ({
        bundleId,
        bundleName: bundle.name,
        result: await runSingleBundleChatRetrieval(
          {
            ...input,
            deferRawRagFallback: input.decision.route === "okf_only",
            knowledgeBundleId: bundleId,
            knowledgeBundleIds: undefined,
          },
          retrieve,
          retrieveOkf,
          traverseGraph,
          retrieveCoveredRag,
          rerank,
        ),
      })),
    );
    results.push(...batchResults);
  }

  if (
    input.decision.route === "okf_only" &&
    !results.some(({ result }) => result.approvedOkfAvailable) &&
    !results.some(({ result }) => result.metadataClarification)
  ) {
    results.length = 0;
    for (let index = 0; index < rankedBundles.length; index += 2) {
      const batch = rankedBundles.slice(index, index + 2);
      const batchResults = await Promise.all(
        batch.map(async ({ bundle, bundleId }) => ({
          bundleId,
          bundleName: bundle.name,
          result: await runSingleBundleChatRetrieval(
            {
              ...input,
              deferRawRagFallback: false,
              knowledgeBundleId: bundleId,
              knowledgeBundleIds: undefined,
            },
            retrieve,
            retrieveOkf,
            traverseGraph,
            retrieveCoveredRag,
            rerank,
          ),
        })),
      );
      results.push(...batchResults);
    }
  }

  if (results.length === 0) {
    return emptyRetrievalResult(isRetrievalRoute(input.decision.route));
  }
  if (results.length === 1) {
    return annotateBundleIdentity(results[0]!);
  }
  return mergeBundleRetrievalResults(results, input);
}

function scoreBundleForQuery(query: string, searchable: string): number {
  const terms = query
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .filter((term) => term.length > 2);
  const haystack = searchable.normalize("NFKC").toLowerCase();
  return [...new Set(terms)].reduce(
    (score, term) => score + (haystack.includes(term) ? 1 : 0),
    0,
  );
}

async function runSingleBundleChatRetrieval(
  input: {
    clarificationAlreadyAsked?: boolean;
    decision: ChatRouterDecision;
    deferRawRagFallback?: boolean;
    includeSearchSummary?: boolean;
    knowledgeBundleId?: string;
    knowledgeBundleIds?: undefined;
    query: string;
    workspaceId: string;
  },
  retrieve: typeof retrieveDocuments,
  retrieveOkf: OkfBundleRetrievalFn,
  traverseGraph: OkfGraphTraversalFn,
  retrieveCoveredRag: CoveredRagRetrievalFn,
  rerank: typeof rerankRawRagCandidates,
): Promise<ChatRetrievalResult> {
  // The covered-RAG capability remains available to the evaluation tool
  // runtime, but strong approved OKF no longer invokes raw evidence.
  void retrieveCoveredRag;
  const bundleId = input.knowledgeBundleId ?? "kb_general_local";
  const executor = createAgentToolExecutor({
    bundleIds: [bundleId],
    mode: "deterministic",
    route: input.decision.route,
    workspaceId: input.workspaceId,
  });
  const result = await runSingleBundleChatRetrievalCore(
    input,
    (toolInput) =>
      executor.run({
        bundleIds: [bundleId],
        execute: async () => {
          const data = await retrieve(toolInput);
          return { data, resultCount: data.length };
        },
        input: {
          query: toolInput.query,
          sourceTypes: toolInput.filters?.sourceTypes ?? [],
        },
        tool: "searchRawRag",
        allowRawRagFallback: input.decision.route === "okf_only",
      }),
    (toolInput) =>
      executor.run({
        bundleIds: [bundleId],
        execute: async () => {
          const data = await retrieveOkf(toolInput);
          const normalized = normalizeOkfDiagnostics(data);
          return { data, resultCount: normalized.qualifiedEvidence.length };
        },
        input: { query: toolInput.query },
        tool: "searchOkf",
      }),
    (toolInput) =>
      executor.run({
        bundleIds: [bundleId],
        execute: async () => {
          const data = await traverseGraph(toolInput);
          return { data, resultCount: data.concepts.length, warningCodes: data.warnings };
        },
        input: { maxHops: toolInput.maxHops, seedFiles: toolInput.seedFiles },
        tool: "followOkfRelation",
      }),
    rerank,
  );
  return { ...result, agentExecution: executor.trace() };
}

async function runSingleBundleChatRetrievalCore(
  input: {
    clarificationAlreadyAsked?: boolean;
    decision: ChatRouterDecision;
    deferRawRagFallback?: boolean;
    includeSearchSummary?: boolean;
    knowledgeBundleId?: string;
    query: string;
    workspaceId: string;
  },
  retrieve: typeof retrieveDocuments,
  retrieveOkf: OkfBundleRetrievalFn,
  traverseGraph: OkfGraphTraversalFn,
  rerank: typeof rerankRawRagCandidates,
): Promise<ChatRetrievalResult> {
  const {
    clarificationAlreadyAsked = false,
    decision,
    knowledgeBundleId,
    query,
    workspaceId,
  } = input;
  const effectiveKnowledgeBundleId = knowledgeBundleId ?? "kb_general_local";

  if (!isRetrievalRoute(decision.route)) {
    return {
      approvedOkfAvailable: false,
      citations: [],
      evidence: [],
      ragUsedForDiscoveryOnly: false,
      retrievalError: false,
      retrievalToolsCalled: [],
      rerank: { applied: false, dropped: 0, status: "not_applicable" },
      sourcesRead: [],
    };
  }

  const toolsForRoute = retrievalToolsForRoute(decision.route);

  try {
    if (decision.route === "okf_only") {
      const okfDiagnostics = normalizeOkfDiagnostics(await retrieveOkf({
        knowledgeBundleId: effectiveKnowledgeBundleId,
        query,
        topK: OKF_TOP_K,
        workspaceId,
      }));
      const okfResults = okfDiagnostics.qualifiedEvidence;

      if (okfResults.length > 0) {
        if (decision.requiresGraphTraversal) {
          const graph = await traverseGraph({
            knowledgeBundleId: effectiveKnowledgeBundleId,
            seedFiles: okfResults.map((result) => result.filePath),
            workspaceId,
            maxHops: 2,
          });
          const graphResults = graph.concepts.filter(
            (result) => !okfResults.some((direct) => direct.filePath === result.filePath),
          );

          if (graphResults.length > 0) {
            const graphOkfResults = [...okfResults, ...graphResults].slice(0, OKF_TOP_K);
            return buildOkfBundleRetrievalResult(
              graphOkfResults,
              [...toolsForRoute, "okf_relation_traversal"],
              {
                approvedOkfAvailable: true,
                okfEvidenceMode: "graph",
                ragUsedForDiscoveryOnly: false,
              },
              "graph",
              effectiveKnowledgeBundleId,
            );
          }

          const discovery = await fetchBySourceType(retrieve, rerank, {
            approvedOnly: false,
            knowledgeBundleId: effectiveKnowledgeBundleId,
            query,
            sourceType: "raw_extraction",
            topK: RAG_TOP_K,
            workspaceId,
          });
          return buildCombinedRetrievalResult(
            okfResults,
            discovery.results,
            [...toolsForRoute, "okf_relation_traversal", "rag_retrieval"],
            {
              approvedOkfAvailable: true,
              okfEvidenceMode: "direct",
              ragUsedForDiscoveryOnly: false,
            },
            "direct",
            discovery.trace,
            effectiveKnowledgeBundleId,
          );
        }

        return buildOkfBundleRetrievalResult(
          okfResults,
          toolsForRoute,
          {
            approvedOkfAvailable: true,
            ragUsedForDiscoveryOnly: false,
          },
          "direct",
          effectiveKnowledgeBundleId,
        );
      }

      if (!clarificationAlreadyAsked && okfDiagnostics.metadataClarification) {
        return buildMetadataClarificationResult(
          okfDiagnostics.metadataClarification,
          toolsForRoute,
        );
      }

      if (input.deferRawRagFallback) {
        return attachSearchSummary(
          buildOkfBundleRetrievalResult(
            [],
            toolsForRoute,
            {
              approvedOkfAvailable: false,
              ragUsedForDiscoveryOnly: false,
            },
            "direct",
            effectiveKnowledgeBundleId,
          ),
          input,
        );
      }

      // query-router.md fallback rule: okf_only with no approved OKF object
      // downgrades to RAG for discovery only, never presented as official.
      const discovery = await fetchBySourceType(retrieve, rerank, {
        approvedOnly: false,
        knowledgeBundleId: effectiveKnowledgeBundleId,
        query,
        sourceType: "raw_extraction",
        topK: RAG_TOP_K,
        workspaceId,
      });
      return attachSearchSummary(
        buildRetrievalResult(
          discovery.results,
          ["okf_retrieval", "rag_retrieval"],
          {
            approvedOkfAvailable: false,
            ragUsedForDiscoveryOnly: discovery.results.length > 0,
          },
          discovery.trace,
        ),
        input,
      );
    }

    if (decision.route === "rag_only") {
      const reranked = await fetchBySourceType(retrieve, rerank, {
        approvedOnly: false,
        knowledgeBundleId: effectiveKnowledgeBundleId,
        query,
        sourceType: "raw_extraction",
        topK: RAG_TOP_K,
        workspaceId,
      });
      return attachSearchSummary(
        buildRetrievalResult(reranked.results, toolsForRoute, {
          approvedOkfAvailable: false,
          ragUsedForDiscoveryOnly: reranked.results.length > 0,
        }, reranked.trace),
        input,
      );
    }

    // Hybrid reads OKF first, then RAG for the supporting evidence - kept
    // sequential (not parallel) per the design so a later slice can shape
    // the RAG fetch around what OKF already covered.
    const okfDiagnostics = normalizeOkfDiagnostics(await retrieveOkf({
      knowledgeBundleId: effectiveKnowledgeBundleId,
      query,
      topK: OKF_TOP_K,
      workspaceId,
    }));
    const okfResults = okfDiagnostics.qualifiedEvidence;
    if (!clarificationAlreadyAsked && okfDiagnostics.metadataClarification) {
      return buildMetadataClarificationResult(
        okfDiagnostics.metadataClarification,
        ["okf_retrieval"],
      );
    }
    const rag = await fetchBySourceType(retrieve, rerank, {
      approvedOnly: false,
      knowledgeBundleId: effectiveKnowledgeBundleId,
      query,
      sourceType: "raw_extraction",
      topK: RAG_TOP_K,
      workspaceId,
    });

    return attachSearchSummary(
      buildCombinedRetrievalResult(
        okfResults,
        rag.results,
        toolsForRoute,
        {
          approvedOkfAvailable: okfResults.length > 0,
          ragUsedForDiscoveryOnly: okfResults.length === 0 && rag.results.length > 0,
        },
        "direct",
        rag.trace,
        effectiveKnowledgeBundleId,
      ),
      input,
    );
  } catch {
    // A retrieval failure (missing/invalid embedding credentials, budget
    // exceeded, transient provider/db error) must never crash the chat
    // turn or imply an unsupported answer - surface it as unavailable.
    return {
      approvedOkfAvailable: false,
      citations: [],
      evidence: [],
      ragUsedForDiscoveryOnly: false,
      retrievalError: true,
      retrievalToolsCalled: toolsForRoute,
      rerank: { applied: false, dropped: 0, status: "provider_failed" },
      sourcesRead: [],
    };
  }
}

function normalizeBundleScope(input: {
  knowledgeBundleId?: string;
  knowledgeBundleIds?: string[];
}): string[] {
  const requested = input.knowledgeBundleIds?.length
    ? input.knowledgeBundleIds
    : [input.knowledgeBundleId ?? "kb_general_local"];
  return [...new Set(requested.filter(Boolean))].slice(0, 10);
}

function emptyRetrievalResult(retrievalRoute: boolean): ChatRetrievalResult {
  return {
    approvedOkfAvailable: false,
    citations: [],
    evidence: [],
    ragUsedForDiscoveryOnly: false,
    retrievalError: retrievalRoute,
    retrievalToolsCalled: [],
    rerank: {
      applied: false,
      dropped: 0,
      status: retrievalRoute ? "provider_failed" : "not_applicable",
    },
    sourcesRead: [],
  };
}

function annotateBundleIdentity(input: {
  bundleId: string;
  bundleName: string;
  result: ChatRetrievalResult;
}): ChatRetrievalResult {
  return {
    ...input.result,
    citations: input.result.citations.map((citation) => ({
      ...citation,
      knowledgeBundleId: citation.knowledgeBundleId ?? input.bundleId,
      knowledgeBundleName: citation.knowledgeBundleName ?? input.bundleName,
    })),
    evidence: input.result.evidence.map((evidence) => ({
      ...evidence,
      knowledgeBundleId: evidence.knowledgeBundleId ?? input.bundleId,
      knowledgeBundleName: evidence.knowledgeBundleName ?? input.bundleName,
    })),
  };
}

export function mergeBundleRetrievalResults(
  inputs: Array<{ bundleId: string; bundleName: string; result: ChatRetrievalResult }>,
  request: { decision: ChatRouterDecision },
): ChatRetrievalResult {
  const annotated = inputs.map(annotateBundleIdentity);
  const pairs = annotated.flatMap((result, bundleIndex) =>
    result.citations.map((citation) => ({
      bundleIndex,
      citation,
      evidence:
        result.evidence.find((candidate) => candidate.index === citation.index) ??
        citationToEvidence(citation),
    })),
  );
  const anyApproved = annotated.some((result) => result.approvedOkfAvailable);
  const eligiblePairs =
    request.decision.route === "okf_only" && anyApproved
      ? pairs.filter(
          (pair) =>
            pair.citation.sourceType === "okf" ||
            (pair.citation.coveredByOkfConceptIds?.length ?? 0) > 0,
        )
      : pairs;
  eligiblePairs.sort(compareBundleEvidence);
  const okfPairs = eligiblePairs
    .filter((pair) => pair.citation.sourceType === "okf")
    .slice(0, OKF_TOP_K);
  const ragPairs = eligiblePairs
    .filter((pair) => pair.citation.sourceType === "rag")
    .slice(0, RAG_TOP_K);
  const selectedPairs =
    request.decision.route === "rag_only" ? ragPairs : [...okfPairs, ...ragPairs];
  const citations = selectedPairs.map((pair, index) => ({
    ...pair.citation,
    index: index + 1,
  }));
  const evidence = selectedPairs.map((pair, index) => ({
    ...pair.evidence,
    index: index + 1,
  }));
  const crossBundleConflict = detectCrossBundleConflict(citations);
  const executions = aggregateAgentCalls(
    annotated.flatMap((result) => result.agentExecution?.calls ?? []),
  );

  return {
    agentExecution: {
      callLimit: 8,
      calls: executions.map((call, index) => ({ ...call, sequence: index + 1 })),
      mode: "deterministic",
    },
    approvedOkfAvailable: citations.some((citation) => citation.sourceType === "okf"),
    citations,
    crossBundleConflict,
    evidence,
    metadataClarification:
      citations.length === 0
        ? annotated.find((result) => result.metadataClarification)?.metadataClarification
        : undefined,
    okfEvidenceMode: annotated.some((result) => result.okfEvidenceMode === "graph")
      ? "graph"
      : annotated.some((result) => result.okfEvidenceMode)
        ? "direct"
        : undefined,
    okfMatchMode: annotated.some((result) => result.okfMatchMode === "lexical")
      ? "lexical"
      : annotated.some((result) => result.okfMatchMode === "vector")
        ? "vector"
        : undefined,
    ragUsedForDiscoveryOnly:
      !anyApproved && citations.some((citation) => citation.sourceType === "rag"),
    rerank:
      annotated.find((result) => result.rerank.applied)?.rerank ??
      annotated.find((result) => result.rerank.status !== "not_applicable")?.rerank ?? {
        applied: false,
        dropped: 0,
        status: "not_applicable",
      },
    retrievalError: annotated.every((result) => result.retrievalError),
    retrievalToolsCalled: [...new Set(annotated.flatMap((result) => result.retrievalToolsCalled))],
    searchSummary: {
      approvedKnowledgeMatches: annotated.reduce(
        (sum, result) =>
          sum + (result.searchSummary?.approvedKnowledgeMatches ?? result.evidence.filter(
            (evidenceItem) => evidenceItem.sourceType === "okf",
          ).length),
        0,
      ),
      bundlesSearched: annotated.length,
      indexedDocumentsSearched: annotated.reduce(
        (sum, result) => sum + (result.searchSummary?.indexedDocumentsSearched ?? 0),
        0,
      ),
    },
    sourcesRead: [
      ...new Set(
        annotated.flatMap((result, index) =>
          result.sourcesRead.map((source) => `${inputs[index]!.bundleName}: ${source}`),
        ),
      ),
    ],
  };
}

export function mergeAdaptiveRetrievalResults(
  original: ChatRetrievalResult,
  retry: ChatRetrievalResult,
  decision: ChatRouterDecision,
): {
  evidenceDelta: { approvedOkf: number; citations: number; rawRag: number };
  result: ChatRetrievalResult;
} {
  const seen = new Set<string>();
  const pairs = [...pairCitationsWithEvidence(original), ...pairCitationsWithEvidence(retry)]
    .filter((pair) => {
      const key = citationIdentity(pair.citation);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const okfPairs = pairs
    .filter((pair) => pair.citation.sourceType === "okf")
    .slice(0, OKF_TOP_K);
  const ragPairs = pairs
    .filter((pair) => pair.citation.sourceType === "rag")
    .slice(0, RAG_TOP_K);
  const selected = decision.route === "rag_only" ? ragPairs : [...okfPairs, ...ragPairs];
  const citations = selected.map((pair, index) => ({
    ...pair.citation,
    index: index + 1,
  }));
  const evidence = selected.map((pair, index) => ({
    ...pair.evidence,
    index: index + 1,
  }));
  const originalKeys = new Set(original.citations.map(citationIdentity));
  const added = citations.filter((citation) => !originalKeys.has(citationIdentity(citation)));
  const approvedOkfAvailable = citations.some(
    (citation) => citation.sourceType === "okf",
  );
  const calls = aggregateAgentCalls([
    ...(original.agentExecution?.calls ?? []),
    ...(retry.agentExecution?.calls ?? []),
  ]);

  return {
    evidenceDelta: {
      approvedOkf: added.filter((citation) => citation.sourceType === "okf").length,
      citations: added.length,
      rawRag: added.filter((citation) => citation.sourceType === "rag").length,
    },
    result: {
      agentExecution: {
        callLimit: 8,
        calls: calls.map((call, index) => ({ ...call, sequence: index + 1 })),
        mode: "deterministic",
      },
      approvedOkfAvailable,
      citations,
      crossBundleConflict: detectCrossBundleConflict(citations),
      evidence,
      okfEvidenceMode:
        retry.okfEvidenceMode === "graph" || original.okfEvidenceMode === "graph"
          ? "graph"
          : retry.okfEvidenceMode ?? original.okfEvidenceMode,
      okfMatchMode:
        retry.okfMatchMode === "lexical" || original.okfMatchMode === "lexical"
          ? "lexical"
          : retry.okfMatchMode ?? original.okfMatchMode,
      ragUsedForDiscoveryOnly:
        !approvedOkfAvailable &&
        citations.some((citation) => citation.sourceType === "rag"),
      rerank: retry.rerank.applied ? retry.rerank : original.rerank,
      retrievalError: original.retrievalError && retry.retrievalError,
      retrievalToolsCalled: [
        ...new Set([
          ...original.retrievalToolsCalled,
          ...retry.retrievalToolsCalled,
        ]),
      ],
      searchSummary: retry.searchSummary ?? original.searchSummary,
      sourcesRead: [...new Set([...original.sourcesRead, ...retry.sourcesRead])],
    },
  };
}

function pairCitationsWithEvidence(result: ChatRetrievalResult) {
  return result.citations.map((citation) => ({
    citation,
    evidence:
      result.evidence.find((candidate) => candidate.index === citation.index) ??
      citationToEvidence(citation),
  }));
}

function citationIdentity(citation: ChatCitation): string {
  return [
    citation.sourceType,
    citation.knowledgeBundleId ?? "",
    citation.okfFilePath ?? "",
    citation.documentId ?? "",
    citation.documentTitle,
    citation.pageStart,
    citation.pageEnd,
  ].join("|");
}

async function resolveActiveScopeBundles(input: {
  bundleIds: string[];
  workspaceId: string;
}): Promise<ChatScopeBundle[]> {
  const bundles = await Promise.all(
    input.bundleIds.map(async (bundleId) => {
      const bundle = await getKnowledgeBundleByIdentity({
        bundleId,
        workspaceId: input.workspaceId,
      });
      if (!bundle) return null;
      let indexContent = "";
      try {
        indexContent = (
          await readOkfBundleFile(
            resolveKnowledgeBundleRoot({
              bundleId,
              workspaceId: input.workspaceId,
            }),
            "index.md",
          )
        ).content;
      } catch {
        // A missing index must not make an otherwise active selected bundle
        // disappear from the user's explicit search scope.
      }
      return {
        description: bundle.description,
        id: bundle.id,
        indexContent,
        name: bundle.name,
      };
    }),
  );
  return bundles.filter((bundle): bundle is ChatScopeBundle => Boolean(bundle));
}

function aggregateAgentCalls(
  calls: NonNullable<ChatRetrievalResult["agentExecution"]>["calls"],
): NonNullable<ChatRetrievalResult["agentExecution"]>["calls"] {
  const grouped = new Map<string, (typeof calls)[number]>();
  for (const call of calls) {
    const key = `${call.tool}:${call.status}`;
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, { ...call, bundleIds: [...call.bundleIds] });
      continue;
    }
    current.bundleIds = [...new Set([...current.bundleIds, ...call.bundleIds])];
    current.resultCount += call.resultCount;
    current.warningCodes = [
      ...new Set([...current.warningCodes, ...call.warningCodes]),
    ];
  }
  return [...grouped.values()];
}

function compareBundleEvidence(
  left: { bundleIndex: number; citation: ChatCitation },
  right: { bundleIndex: number; citation: ChatCitation },
): number {
  const trust = (citation: ChatCitation) =>
    citation.sourceType === "rag"
      ? 3
      : citation.approvalProvenance === "human"
        ? 0
        : citation.approvalProvenance === "automated"
          ? 1
          : 2;
  return (
    trust(left.citation) - trust(right.citation) ||
    left.bundleIndex - right.bundleIndex ||
    left.citation.index - right.citation.index
  );
}

function citationToEvidence(citation: ChatCitation): ChatRetrievalEvidence {
  return {
    approvalProvenance: citation.approvalProvenance,
    documentTitle: citation.documentTitle,
    index: citation.index,
    knowledgeBundleId: citation.knowledgeBundleId,
    knowledgeBundleName: citation.knowledgeBundleName,
    okfEvidenceMode: citation.okfEvidenceMode,
    okfFilePath: citation.okfFilePath,
    pageEnd: citation.pageEnd,
    pageStart: citation.pageStart,
    sourceFile: citation.sourceFile,
    sourceType: citation.sourceType,
    text: citation.text,
  };
}

function detectCrossBundleConflict(citations: ChatCitation[]): {
  detected: boolean;
  bundleIds: string[];
  conflictingValues: string[];
} {
  const okf = citations.filter(
    (citation) => citation.sourceType === "okf" && citation.knowledgeBundleId,
  );
  const conflicts = new Set<string>();
  const bundles = new Set<string>();
  for (let leftIndex = 0; leftIndex < okf.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < okf.length; rightIndex += 1) {
      const left = okf[leftIndex]!;
      const right = okf[rightIndex]!;
      if (left.knowledgeBundleId === right.knowledgeBundleId) continue;
      if (sharedMeaningfulTerms(left.documentTitle, right.documentTitle) < 2) continue;
      const leftValues = extractExactValues(left.text);
      const rightValues = extractExactValues(right.text);
      if (
        leftValues.size > 0 &&
        rightValues.size > 0 &&
        !setsEqual(leftValues, rightValues)
      ) {
        leftValues.forEach((value) => conflicts.add(value));
        rightValues.forEach((value) => conflicts.add(value));
        bundles.add(left.knowledgeBundleId!);
        bundles.add(right.knowledgeBundleId!);
      }
    }
  }
  return {
    bundleIds: [...bundles].sort(),
    conflictingValues: [...conflicts].sort(),
    detected: conflicts.size > 0,
  };
}

function sharedMeaningfulTerms(left: string, right: string): number {
  const stopwords = new Set(["a", "an", "and", "for", "of", "or", "the", "to"]);
  const tokenize = (value: string) =>
    new Set(
      value
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .split(/\s+/)
        .filter((term) => term.length > 1 && !stopwords.has(term)),
    );
  const rightTerms = tokenize(right);
  return [...tokenize(left)].filter((term) => rightTerms.has(term)).length;
}

function extractExactValues(value: string): Set<string> {
  return new Set(
    value.match(/\b\d{4}-\d{2}-\d{2}\b|\b\d+(?:\.\d+)?(?:%|[A-Za-z]+)?\b/g) ?? [],
  );
}

function setsEqual(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

async function attachSearchSummary(
  result: ChatRetrievalResult,
  input: {
    includeSearchSummary?: boolean;
    knowledgeBundleId?: string;
    workspaceId: string;
  },
): Promise<ChatRetrievalResult> {
  if (
    !input.includeSearchSummary ||
    result.citations.length > 0 ||
    result.metadataClarification ||
    result.retrievalError
  ) {
    return result;
  }

  const knowledgeBundleId = input.knowledgeBundleId ?? "kb_general_local";
  const db = getPrisma();
  const [bundlesSearched, indexedDocumentsSearched] = await Promise.all([
    db.knowledgeBundle.count({
      where: {
        id: knowledgeBundleId,
        status: "active",
        workspaceId: input.workspaceId,
      },
    }),
    db.document.count({
      where: {
        deletedAt: null,
        knowledgeBundleId,
        ragChunks: {
          some: { isActive: true, sourceType: "raw_extraction" },
        },
        workspaceId: input.workspaceId,
      },
    }),
  ]);

  return {
    ...result,
    searchSummary: {
      approvedKnowledgeMatches: 0,
      bundlesSearched,
      indexedDocumentsSearched,
    },
  };
}

function normalizeOkfDiagnostics(
  result: OkfBundleEvidence[] | OkfBundleRetrievalDiagnostics,
): OkfBundleRetrievalDiagnostics {
  return Array.isArray(result)
    ? { nearMissCandidates: [], qualifiedEvidence: result }
    : result;
}

function buildMetadataClarificationResult(
  metadataClarification: MetadataClarification,
  retrievalToolsCalled: string[],
): ChatRetrievalResult {
  return {
    approvedOkfAvailable: false,
    citations: [],
    evidence: [],
    metadataClarification,
    ragUsedForDiscoveryOnly: false,
    rerank: { applied: false, dropped: 0, status: "not_applicable" },
    retrievalError: false,
    retrievalToolsCalled,
    sourcesRead: [],
  };
}

function retrievalToolsForRoute(route: ChatRoute): string[] {
  if (route === "okf_only") {
    return ["okf_retrieval"];
  }

  if (route === "rag_only") {
    return ["rag_retrieval"];
  }

  return ["okf_retrieval", "rag_retrieval"];
}

async function fetchBySourceType(
  retrieve: typeof retrieveDocuments,
  rerank: typeof rerankRawRagCandidates,
  options: {
    approvedOnly: boolean;
    knowledgeBundleId: string;
    query: string;
    sourceType: "raw_extraction";
    topK: number;
    workspaceId: string;
  },
): Promise<{ results: RetrievalResult[]; trace: RagRerankTrace }> {
  const results = await retrieve({
    filters: {
      ...(options.approvedOnly ? { reviewStatus: ["approved"] } : {}),
      sourceTypes: [options.sourceType],
    },
    knowledgeBundleId: options.knowledgeBundleId,
    mode: "hybrid",
    query: options.query,
    topK: 10,
    workspaceId: options.workspaceId,
  });

  const candidates = results
    .filter((result) => result.sourceType === options.sourceType)
    .filter((result) => !options.approvedOnly || result.reviewStatus === "approved")
    .slice(0, 10);
  const reranked = await rerank({ candidates, query: options.query, workspaceId: options.workspaceId });
  return { results: reranked.results.slice(0, options.topK), trace: reranked.trace };
}

function buildRetrievalResult(
  results: RetrievalResult[],
  retrievalToolsCalled: string[],
  flags: Pick<ChatRetrievalResult, "approvedOkfAvailable" | "ragUsedForDiscoveryOnly">,
  rerank: RagRerankTrace = { applied: false, dropped: 0, status: "not_applicable" },
): ChatRetrievalResult {
  const citations = results.map((result, index) => toChatCitation(result, index + 1));
  const evidence = results.map((result, index) => toEvidence(result, index + 1));
  const sourcesRead = Array.from(
    new Set(results.map((result) => `${result.documentTitle} (p. ${formatPageRange(result)})`)),
  );

  return {
    ...flags,
    citations,
    evidence,
    retrievalError: false,
    retrievalToolsCalled,
    rerank,
    sourcesRead,
  };
}

function buildOkfBundleRetrievalResult(
  results: OkfBundleEvidence[],
  retrievalToolsCalled: string[],
  flags: Pick<
    ChatRetrievalResult,
    "approvedOkfAvailable" | "okfEvidenceMode" | "ragUsedForDiscoveryOnly"
  >,
  okfEvidenceMode: "direct" | "graph" = "direct",
  knowledgeBundleId?: string,
): ChatRetrievalResult {
  const citations = results.map((result, index) =>
    okfBundleToChatCitation(
      result,
      index + 1,
      okfEvidenceMode,
      knowledgeBundleId,
    ),
  );
  const evidence = results.map((result, index) =>
    okfBundleToEvidence(result, index + 1, okfEvidenceMode),
  );
  const sourcesRead = Array.from(
    new Set(
      results.map(
        (result) =>
          `${result.title} (${result.sourceFile} p. ${formatOkfPageRange(result)})`,
      ),
    ),
  );

  return {
    ...flags,
    citations,
    evidence,
    retrievalError: false,
    retrievalToolsCalled,
    sourcesRead,
    okfEvidenceMode,
    rerank: { applied: false, dropped: 0, status: "not_applicable" },
    okfMatchMode: results[0]?.okfMatchMode,
  };
}

function buildCombinedRetrievalResult(
  okfResults: OkfBundleEvidence[],
  ragResults: RetrievalResult[],
  retrievalToolsCalled: string[],
  flags: Pick<
    ChatRetrievalResult,
    "approvedOkfAvailable" | "okfEvidenceMode" | "ragUsedForDiscoveryOnly"
  >,
  okfEvidenceMode: "direct" | "graph" = "direct",
  rerank: RagRerankTrace = { applied: false, dropped: 0, status: "not_applicable" },
  knowledgeBundleId?: string,
): ChatRetrievalResult {
  const okfCitations = okfResults.map((result, index) =>
    okfBundleToChatCitation(
      result,
      index + 1,
      okfEvidenceMode,
      knowledgeBundleId,
    ),
  );
  const ragCitations = ragResults.map((result, index) =>
    toChatCitation(result, okfCitations.length + index + 1),
  );
  const okfEvidence = okfResults.map((result, index) =>
    okfBundleToEvidence(result, index + 1, okfEvidenceMode),
  );
  const ragEvidence = ragResults.map((result, index) =>
    toEvidence(result, okfEvidence.length + index + 1),
  );
  const sourcesRead = Array.from(
    new Set([
      ...okfResults.map(
        (result) =>
          `${result.title} (${result.sourceFile} p. ${formatOkfPageRange(result)})`,
      ),
      ...ragResults.map(
        (result) => `${result.documentTitle} (p. ${formatPageRange(result)})`,
      ),
    ]),
  );

  return {
    ...flags,
    citations: [...okfCitations, ...ragCitations],
    evidence: [...okfEvidence, ...ragEvidence],
    retrievalError: false,
    retrievalToolsCalled,
    rerank,
    sourcesRead,
    okfMatchMode: okfResults[0]?.okfMatchMode,
  };
}

function toChatCitation(result: RetrievalResult, index: number): ChatCitation {
  return {
    coveredByOkfConceptIds: result.coveredByOkfConceptIds,
    documentTitle: result.documentTitle,
    documentId: result.documentId,
    index,
    pageEnd: result.pageEnd,
    pageStart: result.pageStart,
    sourceType: "rag",
    text: truncateExcerpt(result.text, CITATION_EXCERPT_MAX_CHARS),
  };
}

function okfBundleToChatCitation(
  result: OkfBundleEvidence,
  index: number,
  okfEvidenceMode: "direct" | "graph" = "direct",
  knowledgeBundleId?: string,
): ChatCitation {
  return {
    approvalProvenance: result.approvalProvenance,
    coveredByOkfConceptIds: [],
    documentTitle: result.title,
    index,
    ...(knowledgeBundleId ? { knowledgeBundleId } : {}),
    okfEvidenceMode,
    okfFilePath: result.filePath,
    pageEnd: result.pageEnd,
    pageStart: result.pageStart,
    sourceFile: result.sourceFile,
    sourceType: "okf",
    text: truncateExcerpt(result.excerpt, CITATION_EXCERPT_MAX_CHARS),
  };
}

function toEvidence(result: RetrievalResult, index: number): ChatRetrievalEvidence {
  return {
    documentTitle: result.documentTitle,
    index,
    pageEnd: result.pageEnd,
    pageStart: result.pageStart,
    sourceType: "rag",
    text: truncateExcerpt(result.text, EVIDENCE_EXCERPT_MAX_CHARS),
  };
}

function okfBundleToEvidence(
  result: OkfBundleEvidence,
  index: number,
  okfEvidenceMode: "direct" | "graph" = "direct",
): ChatRetrievalEvidence {
  return {
    approvalProvenance: result.approvalProvenance,
    documentTitle: result.title,
    index,
    okfEvidenceMode,
    okfFilePath: result.filePath,
    pageEnd: result.pageEnd,
    pageStart: result.pageStart,
    sourceFile: result.sourceFile,
    sourceType: "okf",
    text: truncateExcerpt(result.excerpt, EVIDENCE_EXCERPT_MAX_CHARS),
  };
}

function formatPageRange(result: RetrievalResult): string {
  return result.pageStart === result.pageEnd
    ? `${result.pageStart}`
    : `${result.pageStart}-${result.pageEnd}`;
}

function formatOkfPageRange(result: OkfBundleEvidence): string {
  return result.pageStart === result.pageEnd
    ? `${result.pageStart}`
    : `${result.pageStart}-${result.pageEnd}`;
}

function truncateExcerpt(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > maxChars
    ? `${normalized.slice(0, maxChars - 3).trimEnd()}...`
    : normalized;
}

export type RetrievalAnswerInput = Pick<
  ChatRetrievalResult,
  "citations" | "retrievalError"
> & Partial<Pick<ChatRetrievalResult, "retrievalToolsCalled" | "searchSummary" | "sourcesRead">> & {
  crossBundleConflict?: ChatRetrievalResult["crossBundleConflict"];
  ragUsedForDiscoveryOnly?: boolean;
};

export function buildRetrievalAnswer(
  route: ChatRoute,
  retrieval: RetrievalAnswerInput,
): string {
  if (retrieval.retrievalError) {
    return "Retrieval is temporarily unavailable, so this can't be answered with cited evidence right now. Please try again shortly.";
  }

  if (retrieval.citations.length === 0) {
    return buildMissingEvidenceAnswer(route, retrieval);
  }

  const body = retrieval.citations
    .map((citation) => `${citation.text} [${citation.index}]`)
    .join(" ");
  return `${introForRetrieval(route, retrieval)} ${body}`;
}

export function resolveEvidenceStatus(
  retrieval: Pick<
    ChatRetrievalResult,
    | "approvedOkfAvailable"
    | "citations"
    | "metadataClarification"
    | "retrievalError"
  >,
): ChatEvidenceStatus {
  if (retrieval.retrievalError) {
    return "retrieval_error";
  }

  if (retrieval.metadataClarification) {
    return "weak_evidence";
  }

  if (retrieval.citations.length === 0) {
    return "no_evidence";
  }

  return retrieval.approvedOkfAvailable ? "approved_evidence" : "discovery_evidence";
}

function introForRetrieval(
  route: ChatRoute,
  retrieval: RetrievalAnswerInput,
): string {
  // A downgraded OKF/hybrid answer must not read as official knowledge.
  if (retrieval.ragUsedForDiscoveryOnly && route !== "rag_only") {
    return "No reviewed answer exists for this yet. From the raw indexed documents (unreviewed):";
  }

  if (route === "okf_only") {
    return "Approved knowledge base:";
  }

  if (route === "rag_only") {
    return "Found in the indexed documents:";
  }

  return "Approved knowledge plus supporting raw evidence:";
}

function buildMissingEvidenceAnswer(
  route: ChatRoute,
  retrieval: RetrievalAnswerInput,
): string {
  if (retrieval.searchSummary) {
    const summary = retrieval.searchSummary;
    return `I could not find enough supported evidence to answer this reliably. I searched ${summary.bundlesSearched} active knowledge bundle${summary.bundlesSearched === 1 ? "" : "s"} (${summary.approvedKnowledgeMatches} approved knowledge matches) and ${summary.indexedDocumentsSearched} indexed document${summary.indexedDocumentsSearched === 1 ? "" : "s"}. Next, rephrase the question with a specific document, subject, version, or scope, or add and review a source because the current knowledge does not cover this yet.`;
  }

  const sourcesRead = retrieval.sourcesRead ?? [];
  const toolsCalled = retrieval.retrievalToolsCalled ?? [];
  const searched = sourcesRead.length > 0
    ? sourcesRead.join(", ")
    : toolsCalled.length > 0
      ? toolsCalled.map(formatRetrievalTool).join(", ")
      : route === "rag_only"
        ? "the indexed source documents"
        : route === "okf_only"
          ? "the approved knowledge bundle and raw document fallback"
          : "the approved knowledge bundle and indexed source documents";

  return `I could not find enough supported evidence to answer this reliably. I searched ${searched}. Next, name the specific document, subject, version, or scope you mean, or add and review a source that covers the missing information.`;
}

function formatRetrievalTool(tool: string): string {
  return tool.replaceAll("_", " ");
}

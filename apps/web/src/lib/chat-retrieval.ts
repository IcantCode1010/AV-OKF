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
import { rerankRawRagCandidates, type RagRerankTrace } from "./rag-reranker.ts";

const OKF_TOP_K = 4;
const RAG_TOP_K = 6;
const CITATION_EXCERPT_MAX_CHARS = 240;
// Evidence excerpts feed the LLM answer builder, so they carry much more of
// the chunk than the short persisted/rendered citation excerpts do.
const EVIDENCE_EXCERPT_MAX_CHARS = 1500;

// Fuller-text counterpart to a ChatCitation, keyed by the same index. Used
// only to prompt the answer builder; never persisted or rendered.
export type ChatRetrievalEvidence = {
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
  sourcesRead: string[];
};

export type ChatRetrievalFn = (input: {
  decision: ChatRouterDecision;
  clarificationAlreadyAsked?: boolean;
  knowledgeBundleId?: string;
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
    knowledgeBundleId?: string;
    query: string;
    workspaceId: string;
  },
  retrieve: typeof retrieveDocuments = retrieveDocuments,
  retrieveOkf: OkfBundleRetrievalFn = retrieveOkfBundleDiagnosticsWithLifecycle,
  traverseGraph: OkfGraphTraversalFn = traverseOkfRelationsWithLifecycle,
  retrieveCoveredRag: CoveredRagRetrievalFn = retrieveDocumentsByChunkIds,
  rerank: typeof rerankRawRagCandidates = rerankRawRagCandidates,
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
            const coveredRag = await retrieveCoveredRag({
              chunkIds: uniqueChunkIds(graphResults),
              knowledgeBundleId: effectiveKnowledgeBundleId,
              topK: RAG_TOP_K,
              workspaceId,
            });
            const graphOkfResults = [...okfResults, ...graphResults].slice(0, OKF_TOP_K);

            if (coveredRag.length > 0) {
              return buildCombinedRetrievalResult(
                graphOkfResults,
                coveredRag,
                [...toolsForRoute, "okf_relation_traversal", "okf_coverage_rag"],
                {
                  approvedOkfAvailable: true,
                  okfEvidenceMode: "graph",
                  ragUsedForDiscoveryOnly: false,
                },
                "graph",
              );
            }

            return buildOkfBundleRetrievalResult(
              graphOkfResults,
              [...toolsForRoute, "okf_relation_traversal"],
              {
                approvedOkfAvailable: true,
                okfEvidenceMode: "graph",
                ragUsedForDiscoveryOnly: false,
              },
              "graph",
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
          );
        }

        return buildOkfBundleRetrievalResult(okfResults, toolsForRoute, {
          approvedOkfAvailable: true,
          ragUsedForDiscoveryOnly: false,
        });
      }

      if (!clarificationAlreadyAsked && okfDiagnostics.metadataClarification) {
        return buildMetadataClarificationResult(
          okfDiagnostics.metadataClarification,
          toolsForRoute,
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
      return buildRetrievalResult(
        discovery.results,
        ["okf_retrieval", "rag_retrieval"],
        {
          approvedOkfAvailable: false,
          ragUsedForDiscoveryOnly: discovery.results.length > 0,
        },
        discovery.trace,
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
      return buildRetrievalResult(reranked.results, toolsForRoute, {
        approvedOkfAvailable: false,
        ragUsedForDiscoveryOnly: reranked.results.length > 0,
      }, reranked.trace);
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

    return buildCombinedRetrievalResult(okfResults, rag.results, toolsForRoute, {
      approvedOkfAvailable: okfResults.length > 0,
      ragUsedForDiscoveryOnly: okfResults.length === 0 && rag.results.length > 0,
    }, "direct", rag.trace);
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
): ChatRetrievalResult {
  const citations = results.map((result, index) =>
    okfBundleToChatCitation(result, index + 1, okfEvidenceMode),
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
): ChatRetrievalResult {
  const okfCitations = okfResults.map((result, index) =>
    okfBundleToChatCitation(result, index + 1, okfEvidenceMode),
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

function uniqueChunkIds(results: OkfBundleEvidence[]): string[] {
  return Array.from(
    new Set(results.flatMap((result) => result.coveredRagChunkIds)),
  );
}

function toChatCitation(result: RetrievalResult, index: number): ChatCitation {
  return {
    coveredByOkfConceptIds: result.coveredByOkfConceptIds,
    documentTitle: result.documentTitle,
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
): ChatCitation {
  return {
    coveredByOkfConceptIds: [],
    documentTitle: result.title,
    index,
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
> & { ragUsedForDiscoveryOnly?: boolean };

export function buildRetrievalAnswer(
  route: ChatRoute,
  retrieval: RetrievalAnswerInput,
): string {
  if (retrieval.retrievalError) {
    return "Retrieval is temporarily unavailable, so this can't be answered with cited evidence right now. Please try again shortly.";
  }

  if (retrieval.citations.length === 0) {
    return buildMissingEvidenceAnswer(route);
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

function buildMissingEvidenceAnswer(route: ChatRoute): string {
  if (route === "okf_only") {
    return "The approved knowledge base does not have a reviewed answer for this yet. No approved OKF topics matched this question.";
  }

  if (route === "rag_only") {
    return "No indexed document content matched this question yet.";
  }

  return "Neither the approved knowledge base nor the indexed documents have supporting evidence for this question yet.";
}

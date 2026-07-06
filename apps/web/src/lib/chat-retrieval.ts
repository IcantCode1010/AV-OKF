import {
  isRetrievalRoute,
  type ChatEvidenceStatus,
  type ChatRoute,
  type ChatRouterDecision,
} from "./chat-router.ts";
import type { ChatCitation } from "./chat-types.ts";
import { retrieveDocuments } from "./rag-backend.ts";
import type { RetrievalResult } from "./rag-types.ts";

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
  pageEnd: number;
  pageStart: number;
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
  // discovery — either a rag_only answer or an OKF route downgraded because
  // no approved evidence existed. Never true when OKF evidence is present.
  ragUsedForDiscoveryOnly: boolean;
  retrievalError: boolean;
  retrievalToolsCalled: string[];
  sourcesRead: string[];
};

export type ChatRetrievalFn = (input: {
  decision: ChatRouterDecision;
  query: string;
  workspaceId: string;
}) => Promise<ChatRetrievalResult>;

export async function runChatRetrieval(
  input: { decision: ChatRouterDecision; query: string; workspaceId: string },
  retrieve: typeof retrieveDocuments = retrieveDocuments,
): Promise<ChatRetrievalResult> {
  const { decision, query, workspaceId } = input;

  if (!isRetrievalRoute(decision.route)) {
    return {
      approvedOkfAvailable: false,
      citations: [],
      evidence: [],
      ragUsedForDiscoveryOnly: false,
      retrievalError: false,
      retrievalToolsCalled: [],
      sourcesRead: [],
    };
  }

  const toolsForRoute = retrievalToolsForRoute(decision.route);

  try {
    if (decision.route === "okf_only") {
      const okfResults = await fetchBySourceType(retrieve, {
        approvedOnly: true,
        query,
        sourceType: "okf_topic",
        topK: OKF_TOP_K,
        workspaceId,
      });

      if (okfResults.length > 0) {
        return buildRetrievalResult(okfResults, toolsForRoute, {
          approvedOkfAvailable: true,
          ragUsedForDiscoveryOnly: false,
        });
      }

      // query-router.md fallback rule: okf_only with no approved OKF object
      // downgrades to RAG for discovery only — never presented as official.
      const discoveryResults = await fetchBySourceType(retrieve, {
        approvedOnly: false,
        query,
        sourceType: "raw_extraction",
        topK: RAG_TOP_K,
        workspaceId,
      });
      return buildRetrievalResult(
        discoveryResults,
        ["okf_retrieval", "rag_retrieval"],
        {
          approvedOkfAvailable: false,
          ragUsedForDiscoveryOnly: discoveryResults.length > 0,
        },
      );
    }

    if (decision.route === "rag_only") {
      const results = await fetchBySourceType(retrieve, {
        approvedOnly: false,
        query,
        sourceType: "raw_extraction",
        topK: RAG_TOP_K,
        workspaceId,
      });
      return buildRetrievalResult(results, toolsForRoute, {
        approvedOkfAvailable: false,
        ragUsedForDiscoveryOnly: results.length > 0,
      });
    }

    // Hybrid reads OKF first, then RAG for the supporting evidence — kept
    // sequential (not parallel) per the design so a later slice can shape
    // the RAG fetch around what OKF already covered.
    const okfResults = await fetchBySourceType(retrieve, {
      approvedOnly: true,
      query,
      sourceType: "okf_topic",
      topK: OKF_TOP_K,
      workspaceId,
    });
    const ragResults = await fetchBySourceType(retrieve, {
      approvedOnly: false,
      query,
      sourceType: "raw_extraction",
      topK: RAG_TOP_K,
      workspaceId,
    });

    return buildRetrievalResult([...okfResults, ...ragResults], toolsForRoute, {
      approvedOkfAvailable: okfResults.length > 0,
      ragUsedForDiscoveryOnly: okfResults.length === 0 && ragResults.length > 0,
    });
  } catch {
    // A retrieval failure (missing/invalid embedding credentials, budget
    // exceeded, transient provider/db error) must never crash the chat
    // turn or imply an unsupported answer — surface it as unavailable.
    return {
      approvedOkfAvailable: false,
      citations: [],
      evidence: [],
      ragUsedForDiscoveryOnly: false,
      retrievalError: true,
      retrievalToolsCalled: toolsForRoute,
      sourcesRead: [],
    };
  }
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
  options: {
    approvedOnly: boolean;
    query: string;
    sourceType: "okf_topic" | "raw_extraction";
    topK: number;
    workspaceId: string;
  },
): Promise<RetrievalResult[]> {
  const results = await retrieve({
    filters: {
      ...(options.approvedOnly ? { reviewStatus: ["approved"] } : {}),
      sourceTypes: [options.sourceType],
    },
    mode: "hybrid",
    query: options.query,
    topK: options.topK,
    workspaceId: options.workspaceId,
  });

  return results
    .filter((result) => result.sourceType === options.sourceType)
    .filter((result) => !options.approvedOnly || result.reviewStatus === "approved")
    .slice(0, options.topK);
}

function buildRetrievalResult(
  results: RetrievalResult[],
  retrievalToolsCalled: string[],
  flags: Pick<ChatRetrievalResult, "approvedOkfAvailable" | "ragUsedForDiscoveryOnly">,
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
    sourcesRead,
  };
}

function toChatCitation(result: RetrievalResult, index: number): ChatCitation {
  return {
    coveredByOkfConceptIds: result.coveredByOkfConceptIds,
    documentTitle: result.documentTitle,
    index,
    pageEnd: result.pageEnd,
    pageStart: result.pageStart,
    sourceType: result.sourceType === "okf_topic" ? "okf" : "rag",
    text: truncateExcerpt(result.text, CITATION_EXCERPT_MAX_CHARS),
  };
}

function toEvidence(result: RetrievalResult, index: number): ChatRetrievalEvidence {
  return {
    documentTitle: result.documentTitle,
    index,
    pageEnd: result.pageEnd,
    pageStart: result.pageStart,
    sourceType: result.sourceType === "okf_topic" ? "okf" : "rag",
    text: truncateExcerpt(result.text, EVIDENCE_EXCERPT_MAX_CHARS),
  };
}

function formatPageRange(result: RetrievalResult): string {
  return result.pageStart === result.pageEnd
    ? `${result.pageStart}`
    : `${result.pageStart}-${result.pageEnd}`;
}

function truncateExcerpt(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > maxChars
    ? `${normalized.slice(0, maxChars - 1).trimEnd()}…`
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
    "approvedOkfAvailable" | "citations" | "retrievalError"
  >,
): ChatEvidenceStatus {
  if (retrieval.retrievalError) {
    return "retrieval_error";
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

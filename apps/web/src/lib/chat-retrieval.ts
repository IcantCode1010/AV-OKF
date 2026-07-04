import { isRetrievalRoute, type ChatRoute, type ChatRouterDecision } from "./chat-router.ts";
import type { ChatCitation } from "./chat-types.ts";
import { retrieveDocuments } from "./rag-backend.ts";
import type { RetrievalResult } from "./rag-types.ts";

const OKF_TOP_K = 4;
const RAG_TOP_K = 6;
// Retrieval filters (source type, approval) are applied client-side below, not
// by the repository, so over-fetch before slicing to the real topK per source.
const OVER_FETCH_MULTIPLIER = 3;
const CITATION_EXCERPT_MAX_CHARS = 240;

export type ChatRetrievalResult = {
  citations: ChatCitation[];
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
    return { citations: [], retrievalError: false, retrievalToolsCalled: [], sourcesRead: [] };
  }

  const toolsForRoute = retrievalToolsForRoute(decision.route);

  try {
    if (decision.route === "okf_only") {
      const results = await fetchBySourceType(retrieve, {
        approvedOnly: true,
        query,
        sourceType: "okf_topic",
        topK: OKF_TOP_K,
        workspaceId,
      });
      return buildRetrievalResult(results, toolsForRoute);
    }

    if (decision.route === "rag_only") {
      const results = await fetchBySourceType(retrieve, {
        approvedOnly: false,
        query,
        sourceType: "raw_extraction",
        topK: RAG_TOP_K,
        workspaceId,
      });
      return buildRetrievalResult(results, toolsForRoute);
    }

    const [okfResults, ragResults] = await Promise.all([
      fetchBySourceType(retrieve, {
        approvedOnly: true,
        query,
        sourceType: "okf_topic",
        topK: OKF_TOP_K,
        workspaceId,
      }),
      fetchBySourceType(retrieve, {
        approvedOnly: false,
        query,
        sourceType: "raw_extraction",
        topK: RAG_TOP_K,
        workspaceId,
      }),
    ]);

    return buildRetrievalResult([...okfResults, ...ragResults], toolsForRoute);
  } catch {
    // A retrieval failure (missing/invalid embedding credentials, budget
    // exceeded, transient provider/db error) must never crash the chat
    // turn or imply an unsupported answer — surface it as unavailable.
    return {
      citations: [],
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
    mode: "hybrid",
    query: options.query,
    topK: options.topK * OVER_FETCH_MULTIPLIER,
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
): ChatRetrievalResult {
  const citations = results.map((result, index) => toChatCitation(result, index + 1));
  const sourcesRead = Array.from(
    new Set(results.map((result) => `${result.documentTitle} (p. ${formatPageRange(result)})`)),
  );

  return { citations, retrievalError: false, retrievalToolsCalled, sourcesRead };
}

function toChatCitation(result: RetrievalResult, index: number): ChatCitation {
  return {
    documentTitle: result.documentTitle,
    index,
    pageEnd: result.pageEnd,
    pageStart: result.pageStart,
    sourceType: result.sourceType === "okf_topic" ? "okf" : "rag",
    text: truncateExcerpt(result.text),
  };
}

function formatPageRange(result: RetrievalResult): string {
  return result.pageStart === result.pageEnd
    ? `${result.pageStart}`
    : `${result.pageStart}-${result.pageEnd}`;
}

function truncateExcerpt(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > CITATION_EXCERPT_MAX_CHARS
    ? `${normalized.slice(0, CITATION_EXCERPT_MAX_CHARS - 1).trimEnd()}…`
    : normalized;
}

export function buildRetrievalAnswer(
  route: ChatRoute,
  retrieval: Pick<ChatRetrievalResult, "citations" | "retrievalError">,
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
  return `${introForRoute(route)} ${body}`;
}

function introForRoute(route: ChatRoute): string {
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

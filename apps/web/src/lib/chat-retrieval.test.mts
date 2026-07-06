import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRetrievalAnswer,
  resolveEvidenceStatus,
  runChatRetrieval,
} from "./chat-retrieval.ts";
import { routeChatQuestion } from "./chat-router.ts";
import type { RetrievalResult } from "./rag-types.ts";

function makeResult(overrides: Partial<RetrievalResult>): RetrievalResult {
  return {
    chunkId: "chunk_1",
    coveredByOkfConceptIds: [],
    documentId: "doc_1",
    documentTitle: "737NG QRH",
    pageEnd: 12,
    pageStart: 12,
    retrievalMode: "hybrid",
    reviewStatus: "approved",
    score: 0.9,
    sourcePageNumbers: [12],
    sourceType: "okf_topic",
    text: "GEN OFF BUS light indicates a generator bus fault.",
    ...overrides,
  };
}

test("okf_only route keeps only approved okf_topic results and calls okf_retrieval", async () => {
  const decision = routeChatQuestion("What is the official manual path for GEN OFF BUS?");
  assert.equal(decision.route, "okf_only");

  const result = await runChatRetrieval(
    { decision, query: "GEN OFF BUS", workspaceId: "wrk_1" },
    async () => [
      makeResult({ chunkId: "c1", sourceType: "okf_topic", reviewStatus: "approved" }),
      makeResult({ chunkId: "c2", sourceType: "okf_topic", reviewStatus: "needs_review" }),
      makeResult({ chunkId: "c3", sourceType: "raw_extraction", reviewStatus: "approved" }),
    ],
  );

  assert.deepEqual(result.retrievalToolsCalled, ["okf_retrieval"]);
  assert.equal(result.citations.length, 1);
  assert.equal(result.citations[0]?.sourceType, "okf");
  assert.equal(result.citations[0]?.index, 1);
  assert.deepEqual(result.sourcesRead, ["737NG QRH (p. 12)"]);
});

test("okf_only downgrades to labeled RAG discovery when no approved OKF evidence exists", async () => {
  const decision = routeChatQuestion("what is DC generation");
  assert.equal(decision.route, "okf_only");

  const requestedSourceTypes: (string[] | undefined)[] = [];
  const result = await runChatRetrieval(
    { decision, query: "what is DC generation", workspaceId: "wrk_1" },
    async (request) => {
      requestedSourceTypes.push(request.filters?.sourceTypes);
      if (request.filters?.sourceTypes?.includes("okf_topic")) {
        return [];
      }
      return [
        makeResult({
          chunkId: "c_raw",
          sourceType: "raw_extraction",
          reviewStatus: "raw_extracted",
        }),
      ];
    },
  );

  assert.deepEqual(requestedSourceTypes, [["okf_topic"], ["raw_extraction"]]);
  assert.deepEqual(result.retrievalToolsCalled, ["okf_retrieval", "rag_retrieval"]);
  assert.equal(result.approvedOkfAvailable, false);
  assert.equal(result.ragUsedForDiscoveryOnly, true);
  assert.equal(result.citations[0]?.sourceType, "rag");

  const answer = buildRetrievalAnswer(decision.route, result);
  assert.match(answer, /no reviewed answer exists/i);
  assert.match(answer, /unreviewed/i);
  assert.doesNotMatch(answer, /^Approved knowledge base:/);
});

test("okf_only with approved evidence never reads as discovery", async () => {
  const decision = routeChatQuestion("What is the official manual path for GEN OFF BUS?");
  const result = await runChatRetrieval(
    { decision, query: "GEN OFF BUS", workspaceId: "wrk_1" },
    async () => [makeResult({ sourceType: "okf_topic", reviewStatus: "approved" })],
  );

  assert.equal(result.approvedOkfAvailable, true);
  assert.equal(result.ragUsedForDiscoveryOnly, false);
  assert.match(buildRetrievalAnswer(decision.route, result), /^Approved knowledge base:/);
});

test("hybrid without approved OKF results is flagged as discovery", async () => {
  const decision = routeChatQuestion(
    "What is the approved policy and show examples from the manuals?",
  );
  assert.equal(decision.route, "hybrid");

  const result = await runChatRetrieval(
    { decision, query: "policy examples", workspaceId: "wrk_1" },
    async (request) =>
      request.filters?.sourceTypes?.includes("okf_topic")
        ? []
        : [makeResult({ chunkId: "c_raw", sourceType: "raw_extraction" })],
  );

  assert.equal(result.approvedOkfAvailable, false);
  assert.equal(result.ragUsedForDiscoveryOnly, true);
});

test("resolveEvidenceStatus maps retrieval outcomes to the trace vocabulary", () => {
  const base = { citations: [], retrievalError: false };
  const citation = {
    documentTitle: "737NG QRH",
    index: 1,
    pageEnd: 12,
    pageStart: 12,
    sourceType: "okf" as const,
    text: "excerpt",
  };

  assert.equal(
    resolveEvidenceStatus({ ...base, approvedOkfAvailable: false, retrievalError: true }),
    "retrieval_error",
  );
  assert.equal(
    resolveEvidenceStatus({ ...base, approvedOkfAvailable: false }),
    "no_evidence",
  );
  assert.equal(
    resolveEvidenceStatus({ approvedOkfAvailable: true, citations: [citation], retrievalError: false }),
    "approved_evidence",
  );
  assert.equal(
    resolveEvidenceStatus({ approvedOkfAvailable: false, citations: [citation], retrievalError: false }),
    "discovery_evidence",
  );
});

test("citations carry coverage links from retrieval results", async () => {
  const decision = routeChatQuestion("Find all documents that mention ELT battery replacement.");
  const result = await runChatRetrieval(
    { decision, query: "ELT battery", workspaceId: "wrk_1" },
    async () => [
      makeResult({
        chunkId: "c_covered",
        sourceType: "raw_extraction",
        coveredByOkfConceptIds: ["okf_elt_battery"],
      }),
    ],
  );

  assert.deepEqual(result.citations[0]?.coveredByOkfConceptIds, ["okf_elt_battery"]);
});

test("retrieval evidence mirrors citation indexes but keeps longer excerpts", async () => {
  const decision = routeChatQuestion("What is the official manual path for GEN OFF BUS?");
  const longText = "GEN OFF BUS light indicates a generator bus fault. ".repeat(12);

  const result = await runChatRetrieval(
    { decision, query: "GEN OFF BUS", workspaceId: "wrk_1" },
    async () => [
      makeResult({ chunkId: "c1", sourceType: "okf_topic", reviewStatus: "approved", text: longText }),
    ],
  );

  assert.equal(result.evidence.length, 1);
  assert.equal(result.evidence[0]?.index, result.citations[0]?.index);
  assert.ok(
    result.evidence[0]!.text.length > result.citations[0]!.text.length,
    "evidence excerpt should be longer than the persisted citation excerpt",
  );
});

test("okf_only route pushes approved OKF filters into retrieval request", async () => {
  const decision = routeChatQuestion("What is the official manual path for GEN OFF BUS?");
  const requests: unknown[] = [];

  await runChatRetrieval(
    { decision, query: "GEN OFF BUS", workspaceId: "wrk_1" },
    async (request) => {
      requests.push(request);
      return [makeResult({ sourceType: "okf_topic", reviewStatus: "approved" })];
    },
  );

  assert.deepEqual(requests, [
    {
      filters: {
        reviewStatus: ["approved"],
        sourceTypes: ["okf_topic"],
      },
      mode: "hybrid",
      query: "GEN OFF BUS",
      topK: 4,
      workspaceId: "wrk_1",
    },
  ]);
});

test("rag_only route keeps raw_extraction results regardless of review status", async () => {
  const decision = routeChatQuestion("Find all documents that mention ELT battery replacement.");
  assert.equal(decision.route, "rag_only");

  const result = await runChatRetrieval(
    { decision, query: "ELT battery", workspaceId: "wrk_1" },
    async () => [
      makeResult({
        chunkId: "c1",
        sourceType: "raw_extraction",
        reviewStatus: "needs_review",
        pageStart: 40,
        pageEnd: 41,
      }),
      makeResult({ chunkId: "c2", sourceType: "okf_topic", reviewStatus: "approved" }),
    ],
  );

  assert.deepEqual(result.retrievalToolsCalled, ["rag_retrieval"]);
  assert.equal(result.citations.length, 1);
  assert.equal(result.citations[0]?.sourceType, "rag");
  assert.deepEqual(result.sourcesRead, ["737NG QRH (p. 40-41)"]);
});

test("hybrid route combines approved okf results with raw extraction results", async () => {
  const decision = routeChatQuestion(
    "What is the approved policy and show examples from the manuals?",
  );
  assert.equal(decision.route, "hybrid");

  const result = await runChatRetrieval(
    { decision, query: "policy examples", workspaceId: "wrk_1" },
    async () => [
      makeResult({ chunkId: "c1", sourceType: "okf_topic", reviewStatus: "approved" }),
      makeResult({ chunkId: "c2", sourceType: "okf_topic", reviewStatus: "needs_review" }),
      makeResult({ chunkId: "c3", sourceType: "raw_extraction", reviewStatus: "approved" }),
    ],
  );

  assert.deepEqual(result.retrievalToolsCalled, ["okf_retrieval", "rag_retrieval"]);
  assert.equal(result.citations.length, 2);
  assert.equal(result.citations[0]?.sourceType, "okf");
  assert.equal(result.citations[0]?.index, 1);
  assert.equal(result.citations[1]?.sourceType, "rag");
  assert.equal(result.citations[1]?.index, 2);
});

test("missing_context and unsupported routes never call retrieve", async () => {
  const missingContext = routeChatQuestion("Can we dispatch?");
  const unsupported = routeChatQuestion("What is today's inventory count?");

  const retrieve = async (): Promise<RetrievalResult[]> => {
    throw new Error("retrieve_should_not_be_called");
  };

  const missingContextResult = await runChatRetrieval(
    { decision: missingContext, query: "Can we dispatch?", workspaceId: "wrk_1" },
    retrieve,
  );
  const unsupportedResult = await runChatRetrieval(
    { decision: unsupported, query: "What is today's inventory count?", workspaceId: "wrk_1" },
    retrieve,
  );

  assert.deepEqual(missingContextResult, {
    approvedOkfAvailable: false,
    citations: [],
    evidence: [],
    ragUsedForDiscoveryOnly: false,
    retrievalError: false,
    retrievalToolsCalled: [],
    sourcesRead: [],
  });
  assert.deepEqual(unsupportedResult, {
    approvedOkfAvailable: false,
    citations: [],
    evidence: [],
    ragUsedForDiscoveryOnly: false,
    retrievalError: false,
    retrievalToolsCalled: [],
    sourcesRead: [],
  });
});

test("a retrieval failure degrades to an error result instead of throwing", async () => {
  const decision = routeChatQuestion("What is the official manual path for GEN OFF BUS?");
  assert.equal(decision.route, "okf_only");

  const result = await runChatRetrieval(
    { decision, query: "GEN OFF BUS", workspaceId: "wrk_1" },
    async () => {
      throw new Error("missing_env_OPENAI_API_KEY");
    },
  );

  assert.deepEqual(result, {
    approvedOkfAvailable: false,
    citations: [],
    evidence: [],
    ragUsedForDiscoveryOnly: false,
    retrievalError: true,
    retrievalToolsCalled: ["okf_retrieval"],
    sourcesRead: [],
  });
});

test("buildRetrievalAnswer reports missing evidence per route when there are no citations", () => {
  const empty = { citations: [], retrievalError: false };
  assert.match(buildRetrievalAnswer("okf_only", empty), /does not have a reviewed answer/i);
  assert.match(buildRetrievalAnswer("rag_only", empty), /no indexed document content/i);
  assert.match(buildRetrievalAnswer("hybrid", empty), /neither the approved knowledge base/i);
});

test("buildRetrievalAnswer reports unavailable retrieval distinctly from missing evidence", () => {
  const answer = buildRetrievalAnswer("okf_only", { citations: [], retrievalError: true });

  assert.match(answer, /temporarily unavailable/i);
  assert.doesNotMatch(answer, /does not have a reviewed answer/i);
});

test("buildRetrievalAnswer cites each retrieved excerpt by index", () => {
  const answer = buildRetrievalAnswer("okf_only", {
    citations: [
      {
        documentTitle: "737NG QRH",
        index: 1,
        pageEnd: 12,
        pageStart: 12,
        sourceType: "okf",
        text: "GEN OFF BUS light indicates a generator bus fault.",
      },
    ],
    retrievalError: false,
  });

  assert.match(answer, /generator bus fault/i);
  assert.match(answer, /\[1\]/);
});

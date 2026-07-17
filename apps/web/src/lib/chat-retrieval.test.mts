import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { buildAnswerEvidenceProfile } from "./chat-evidence-profile.ts";
import {
  buildRetrievalAnswer,
  resolveEvidenceStatus,
  runChatRetrieval,
} from "./chat-retrieval.ts";
import { routeChatQuestion } from "./chat-router.ts";
import {
  retrieveOkfBundleEvidence,
  type OkfBundleEvidence,
} from "./okf-bundle-retriever.ts";
import type { OkfGraphTraversalResult } from "./okf-graph-retriever.ts";
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
    reviewStatus: "raw_extracted",
    score: 0.9,
    sourcePageNumbers: [12],
    sourceType: "raw_extraction",
    text: "GEN OFF BUS light indicates a generator bus fault.",
    ...overrides,
  };
}

function makeOkfEvidence(
  overrides: Partial<OkfBundleEvidence> = {},
): OkfBundleEvidence {
  return {
    body: "GEN OFF BUS light indicates a generator bus fault.",
    coveredRagChunkIds: [],
    coverageType: null,
    description: "GEN OFF BUS dispatch guidance.",
    excerpt: "GEN OFF BUS light indicates a generator bus fault.",
    filePath: "24-gen-off-bus-abc123.md",
    lifecycleStatus: "active",
    lifecycleWarnings: [],
    matchedTerms: ["gen", "off", "bus"],
    matchReason: "strong title phrase match",
    matchStrength: "strong",
    pageEnd: 12,
    pageStart: 12,
    relations: [],
    reviewStatus: "approved",
    score: 120,
    sourceFile: "737NG QRH",
    sourcePages: [12],
    sourceType: "okf_bundle",
    title: "GEN OFF BUS",
    type: "system_topic",
    ...overrides,
  };
}

test("okf_only route reads approved OKF bundle evidence and calls okf_retrieval", async () => {
  const decision = routeChatQuestion("What is the official manual path for GEN OFF BUS?");
  assert.equal(decision.route, "okf_only");
  const okfRequests: unknown[] = [];

  const result = await runChatRetrieval(
    {
      decision,
      knowledgeBundleId: "kb_general",
      query: "GEN OFF BUS",
      workspaceId: "wrk_1",
    },
    async () => {
      throw new Error("rag_should_not_be_called");
    },
    async (request) => {
      okfRequests.push(request);
      return [makeOkfEvidence()];
    },
  );

  assert.deepEqual(okfRequests, [
    {
      knowledgeBundleId: "kb_general",
      query: "GEN OFF BUS",
      topK: 4,
      workspaceId: "wrk_1",
    },
  ]);
  assert.deepEqual(result.retrievalToolsCalled, ["okf_retrieval"]);
  assert.equal(result.citations.length, 1);
  assert.equal(result.citations[0]?.sourceType, "okf");
  assert.equal(result.citations[0]?.okfFilePath, "24-gen-off-bus-abc123.md");
  assert.equal(result.citations[0]?.sourceFile, "737NG QRH");
  assert.equal(result.citations[0]?.index, 1);
  assert.deepEqual(result.sourcesRead, ["GEN OFF BUS (737NG QRH p. 12)"]);
});

test("graph questions traverse approved OKF relations and label graph evidence", async () => {
  const decision = routeChatQuestion(
    "How does the brake control unit affect alternate braking?",
  );
  assert.equal(decision.requiresGraphTraversal, true);

  const graphResult: OkfGraphTraversalResult = {
    concepts: [
      makeOkfEvidence({
        coveredRagChunkIds: ["chunk_covered"],
        filePath: "32-alternate-braking.md",
        title: "Alternate Braking",
      }),
    ],
    paths: [
      {
        files: ["32-brakes.md", "32-alternate-braking.md"],
        relationTypes: ["references"],
      },
    ],
    warnings: [],
  };

  const result = await runChatRetrieval(
    { decision, query: "brake control unit alternate braking", workspaceId: "wrk_1" },
    async () => {
      throw new Error("rag_should_not_be_called");
    },
    async () => [makeOkfEvidence({ filePath: "32-brakes.md" })],
    async (request) => {
      assert.deepEqual(request.seedFiles, ["32-brakes.md"]);
      return graphResult;
    },
    async (request) => {
      assert.deepEqual(request.chunkIds, ["chunk_covered"]);
      return [
        makeResult({
          chunkId: "chunk_covered",
          text: "The source manual describes alternate braking on page 12.",
        }),
      ];
    },
  );

  assert.equal(result.okfEvidenceMode, "graph");
  assert.deepEqual(result.retrievalToolsCalled, [
    "okf_retrieval",
    "okf_relation_traversal",
    "okf_coverage_rag",
  ]);
  assert.deepEqual(
    result.citations.map((citation) => citation.okfEvidenceMode),
    ["graph", "graph", undefined],
  );
  assert.equal(result.citations[2]?.sourceType, "rag");
});

test("okf_only downgrades to labeled RAG discovery when no approved OKF evidence exists", async () => {
  const decision = routeChatQuestion("what is DC generation");
  assert.equal(decision.route, "okf_only");

  const requestedSourceTypes: (string[] | undefined)[] = [];
  const result = await runChatRetrieval(
    { decision, query: "what is DC generation", workspaceId: "wrk_1" },
    async (request) => {
      requestedSourceTypes.push(request.filters?.sourceTypes);
      return [
        makeResult({
          chunkId: "c_raw",
          reviewStatus: "raw_extracted",
          sourceType: "raw_extraction",
        }),
      ];
    },
    async () => [],
  );

  assert.deepEqual(requestedSourceTypes, [["raw_extraction"]]);
  assert.deepEqual(result.retrievalToolsCalled, ["okf_retrieval", "rag_retrieval"]);
  assert.equal(result.approvedOkfAvailable, false);
  assert.equal(result.ragUsedForDiscoveryOnly, true);
  assert.equal(result.citations[0]?.sourceType, "rag");

  const answer = buildRetrievalAnswer(decision.route, result);
  assert.match(answer, /no reviewed answer exists/i);
  assert.match(answer, /unreviewed/i);
  assert.doesNotMatch(answer, /^Approved knowledge base:/);
});

test("okf_only falls back to raw RAG when live OKF bundle relevance is too low", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "av-okf-chat-low-relevance-"));
  const originalKnowledgeRoot = process.env.AV_OKF_KNOWLEDGE_ROOT;

  try {
    process.env.AV_OKF_KNOWLEDGE_ROOT = root;
    await writeChatTopic(root, "32-brakes.md", {
      body: "The brake system provides normal and alternate braking.",
      description:
        "The main gear brake system provides normal and alternate braking.",
      title: "Main Gear Brake System",
    });

    const decision = routeChatQuestion(
      "What is the official manual path for galley water heater leak troubleshooting?",
    );
    assert.equal(decision.route, "okf_only");

    const result = await runChatRetrieval(
      {
        decision,
        query: "galley water heater leak troubleshooting",
        workspaceId: "wrk_1",
      },
      async () => [
        makeResult({
          documentTitle: "Galley Water Manual",
          reviewStatus: "raw_extracted",
          sourceType: "raw_extraction",
          text: "Galley water heater troubleshooting appears in the raw manual.",
        }),
      ],
      retrieveOkfBundleEvidence,
    );
    const profile = buildAnswerEvidenceProfile({
      citations: result.citations,
      trace: {
        ragUsedForDiscoveryOnly: result.ragUsedForDiscoveryOnly,
        route: decision.route,
      },
    });

    assert.equal(result.approvedOkfAvailable, false);
    assert.equal(result.ragUsedForDiscoveryOnly, true);
    assert.equal(result.citations.length, 1);
    assert.equal(result.citations[0]?.sourceType, "rag");
    assert.equal(profile.evidenceKind, "raw_rag");
  } finally {
    if (originalKnowledgeRoot === undefined) {
      delete process.env.AV_OKF_KNOWLEDGE_ROOT;
    } else {
      process.env.AV_OKF_KNOWLEDGE_ROOT = originalKnowledgeRoot;
    }
    await rm(root, { force: true, recursive: true });
  }
});

test("okf_only with approved evidence never reads as discovery", async () => {
  const decision = routeChatQuestion("What is the official manual path for GEN OFF BUS?");
  const result = await runChatRetrieval(
    { decision, query: "GEN OFF BUS", workspaceId: "wrk_1" },
    async () => {
      throw new Error("rag_should_not_be_called");
    },
    async () => [makeOkfEvidence()],
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
    async () => [makeResult({ chunkId: "c_raw", sourceType: "raw_extraction" })],
    async () => [],
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

test("citations carry coverage links from raw retrieval results", async () => {
  const decision = routeChatQuestion("Find all documents that mention ELT battery replacement.");
  const result = await runChatRetrieval(
    { decision, query: "ELT battery", workspaceId: "wrk_1" },
    async () => [
      makeResult({
        chunkId: "c_covered",
        coveredByOkfConceptIds: ["okf_elt_battery"],
        sourceType: "raw_extraction",
      }),
    ],
    async () => {
      throw new Error("okf_should_not_be_called");
    },
  );

  assert.deepEqual(result.citations[0]?.coveredByOkfConceptIds, ["okf_elt_battery"]);
});

test("retrieval evidence mirrors citation indexes but keeps longer excerpts", async () => {
  const decision = routeChatQuestion("What is the official manual path for GEN OFF BUS?");
  const longText = "GEN OFF BUS light indicates a generator bus fault. ".repeat(12);

  const result = await runChatRetrieval(
    { decision, query: "GEN OFF BUS", workspaceId: "wrk_1" },
    async () => {
      throw new Error("rag_should_not_be_called");
    },
    async () => [makeOkfEvidence({ excerpt: longText })],
  );

  assert.equal(result.evidence.length, 1);
  assert.equal(result.evidence[0]?.index, result.citations[0]?.index);
  assert.ok(
    result.evidence[0]!.text.length > result.citations[0]!.text.length,
    "evidence excerpt should be longer than the persisted citation excerpt",
  );
});

test("rag_only route does not call the OKF bundle retriever", async () => {
  const decision = routeChatQuestion("Find all documents that mention ELT battery replacement.");
  assert.equal(decision.route, "rag_only");

  const result = await runChatRetrieval(
    { decision, query: "ELT battery", workspaceId: "wrk_1" },
    async () => [
      makeResult({
        chunkId: "c1",
        pageEnd: 41,
        pageStart: 40,
        reviewStatus: "needs_review",
        sourceType: "raw_extraction",
      }),
      makeResult({ chunkId: "c2", sourceType: "okf_topic", reviewStatus: "approved" }),
    ],
    async () => {
      throw new Error("okf_should_not_be_called");
    },
  );

  assert.deepEqual(result.retrievalToolsCalled, ["rag_retrieval"]);
  assert.equal(result.citations.length, 1);
  assert.equal(result.citations[0]?.sourceType, "rag");
  assert.deepEqual(result.sourcesRead, ["737NG QRH (p. 40-41)"]);
});

test("hybrid route combines approved OKF bundle results with raw extraction results", async () => {
  const decision = routeChatQuestion(
    "What is the approved policy and show examples from the manuals?",
  );
  assert.equal(decision.route, "hybrid");

  const result = await runChatRetrieval(
    { decision, query: "policy examples", workspaceId: "wrk_1" },
    async () => [
      makeResult({ chunkId: "c_raw", reviewStatus: "raw_extracted", sourceType: "raw_extraction" }),
    ],
    async () => [makeOkfEvidence({ title: "Approved Policy" })],
  );

  assert.deepEqual(result.retrievalToolsCalled, ["okf_retrieval", "rag_retrieval"]);
  assert.equal(result.citations.length, 2);
  assert.equal(result.citations[0]?.sourceType, "okf");
  assert.equal(result.citations[0]?.index, 1);
  assert.equal(result.citations[1]?.sourceType, "rag");
  assert.equal(result.citations[1]?.index, 2);
  assert.equal(result.approvedOkfAvailable, true);
  assert.equal(result.ragUsedForDiscoveryOnly, false);
});

test("missing_context and unsupported routes never call retrieve", async () => {
  const missingContext = routeChatQuestion("Can we dispatch?");
  const unsupported = routeChatQuestion("What is today's inventory count?");

  const retrieve = async (): Promise<RetrievalResult[]> => {
    throw new Error("retrieve_should_not_be_called");
  };
  const retrieveOkf = async (): Promise<OkfBundleEvidence[]> => {
    throw new Error("okf_should_not_be_called");
  };

  const missingContextResult = await runChatRetrieval(
    { decision: missingContext, query: "Can we dispatch?", workspaceId: "wrk_1" },
    retrieve,
    retrieveOkf,
  );
  const unsupportedResult = await runChatRetrieval(
    { decision: unsupported, query: "What is today's inventory count?", workspaceId: "wrk_1" },
    retrieve,
    retrieveOkf,
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
    async () => [],
    async () => {
      throw new Error("malformed_okf_bundle");
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

async function writeChatTopic(
  root: string,
  filename: string,
  options: {
    body: string;
    description: string;
    title: string;
  },
) {
  await mkdir(path.dirname(path.join(root, filename)), { recursive: true });
  await writeFile(
    path.join(root, filename),
    [
      "---",
      'type: "system_topic"',
      'review_status: "approved"',
      `title: "${options.title}"`,
      `description: "${options.description}"`,
      'source_file: "737NG AMM 32 Landing Gear"',
      "source_pages:",
      "  - 41",
      "---",
      "",
      "# Topic",
      "",
      options.body,
    ].join("\n"),
    "utf8",
  );
}

test("a hybrid-route OKF failure degrades to an error result with no partial citations", async () => {
  const decision = routeChatQuestion(
    "What is the approved policy and show examples from the manuals?",
  );
  assert.equal(decision.route, "hybrid");

  const result = await runChatRetrieval(
    { decision, query: "policy examples", workspaceId: "wrk_1" },
    async () => [makeResult({ chunkId: "c_raw", sourceType: "raw_extraction" })],
    async () => {
      throw new Error("malformed_okf_bundle");
    },
  );

  assert.deepEqual(result, {
    approvedOkfAvailable: false,
    citations: [],
    evidence: [],
    ragUsedForDiscoveryOnly: false,
    retrievalError: true,
    retrievalToolsCalled: ["okf_retrieval", "rag_retrieval"],
    sourcesRead: [],
  });
});

test("okf_retrieval is always called with topK 4 regardless of route", async () => {
  const okfRequests: unknown[] = [];
  const captureOkf = async (request: {
    query: string;
    topK: number;
    workspaceId: string;
  }) => {
    okfRequests.push(request);
    return [];
  };

  const hybridDecision = routeChatQuestion(
    "What is the approved policy and show examples from the manuals?",
  );
  assert.equal(hybridDecision.route, "hybrid");
  await runChatRetrieval(
    { decision: hybridDecision, query: "policy examples", workspaceId: "wrk_1" },
    async () => [makeResult({ chunkId: "c_raw", sourceType: "raw_extraction" })],
    captureOkf,
  );

  const okfOnlyDecision = routeChatQuestion(
    "What is the official manual path for GEN OFF BUS?",
  );
  assert.equal(okfOnlyDecision.route, "okf_only");
  await runChatRetrieval(
    { decision: okfOnlyDecision, query: "GEN OFF BUS", workspaceId: "wrk_1" },
    async () => [],
    captureOkf,
  );

  assert.equal(okfRequests.length, 2);
  for (const request of okfRequests) {
    assert.equal((request as { topK: number }).topK, 4);
  }
});

test("hybrid discovery-only answers read as unreviewed, not official", () => {
  const discoveryAnswer = buildRetrievalAnswer("hybrid", {
    citations: [
      {
        documentTitle: "737NG QRH",
        index: 1,
        pageEnd: 12,
        pageStart: 12,
        sourceType: "rag",
        text: "Raw excerpt only, no approved OKF concept matched.",
      },
    ],
    ragUsedForDiscoveryOnly: true,
    retrievalError: false,
  });

  assert.match(discoveryAnswer, /no reviewed answer exists for this yet/i);
  assert.doesNotMatch(discoveryAnswer, /approved knowledge/i);
});

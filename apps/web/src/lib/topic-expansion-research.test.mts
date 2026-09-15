import assert from "node:assert/strict";
import test from "node:test";

import { MAX_TOPIC_RESEARCH_ROUNDS, runBoundedTopicResearch } from "./topic-expansion-research.ts";
import type { RetrievalResult } from "./rag-types.ts";

const seed = { body: "Hydraulic power is distributed to flight controls.", entityNames: ["Power Transfer Unit"], id: "topic-a", title: "Hydraulic Power", topicType: "system_topic" };

function chunk(id: string, coveredByOkfConceptIds = ["topic-a"]): RetrievalResult {
  return {
    chunkId: id,
    coveredByOkfConceptIds,
    documentId: "doc-a",
    documentTitle: "Operations Manual",
    pageEnd: 12,
    pageStart: 12,
    retrievalMode: "hybrid",
    reviewStatus: "raw_extracted",
    score: 0.9,
    sourcePageNumbers: [12],
    sourceType: "raw_extraction",
    text: `The power transfer unit ${id} supplies alternate hydraulic pressure.`,
  };
}

test("topic research searches again for grounded terminology and stops when no new chunks appear", async () => {
  let analyses = 0;
  const result = await runBoundedTopicResearch({
    allowedTypes: ["system_topic"],
    concepts: [seed],
    knowledgeBundleId: "bundle-a",
    provider: {
      analyze: async () => {
        analyses += 1;
        return {
          discoveries: [{ evidenceQuote: "The power transfer unit a supplies alternate hydraulic pressure.", newTerminology: ["alternate pressure"], searchQuestions: ["How is alternate pressure supplied?"], supportedClaim: "The power transfer unit supplies alternate hydraulic pressure." }],
          meaningfulNewEvidence: true,
          proposals: [],
        };
      },
      plan: async () => ({ searchQuestions: ["How is hydraulic power distributed?"], synonyms: [] }),
    },
    rerank: async ({ candidates }) => ({ results: candidates }),
    retrieve: async () => [chunk("a")],
    seed,
    workspaceId: "workspace-a",
  });

  assert.equal(analyses, 1);
  assert.equal(result.completedRounds, 1);
  assert.equal(result.searchQueryCount, 3);
  assert.equal(result.evidenceChunkCount, 1);
  assert.equal(result.stopReason, "no_new_chunks");
});

test("topic research rejects chunks that are not coverage-linked to an approved concept", async () => {
  let analyzed = false;
  const result = await runBoundedTopicResearch({
    allowedTypes: ["system_topic"],
    concepts: [seed],
    knowledgeBundleId: "bundle-a",
    provider: {
      analyze: async () => { analyzed = true; throw new Error("should_not_run"); },
      plan: async () => ({ searchQuestions: ["Hydraulic pressure"], synonyms: [] }),
    },
    rerank: async ({ candidates }) => ({ results: candidates }),
    retrieve: async () => [chunk("outside", ["unapproved-topic"])],
    seed,
    workspaceId: "workspace-a",
  });

  assert.equal(analyzed, false);
  assert.equal(result.evidenceChunkCount, 0);
  assert.equal(result.stopReason, "no_new_chunks");
});

test("topic research remains bounded to three rounds", async () => {
  let retrievalRound = 0;
  const result = await runBoundedTopicResearch({
    allowedTypes: ["system_topic"],
    concepts: [seed],
    knowledgeBundleId: "bundle-a",
    provider: {
      analyze: async () => ({
        discoveries: [{ evidenceQuote: "quote", newTerminology: [`term-${retrievalRound}`], searchQuestions: [`question for round ${retrievalRound}`], supportedClaim: "A supported claim with sufficient detail." }],
        meaningfulNewEvidence: true,
        proposals: [],
      }),
      plan: async () => ({ searchQuestions: ["initial hydraulic question"], synonyms: [] }),
    },
    rerank: async ({ candidates }) => ({ results: candidates }),
    retrieve: async () => [chunk(`chunk-${++retrievalRound}`)],
    seed,
    workspaceId: "workspace-a",
  });

  assert.equal(result.completedRounds, MAX_TOPIC_RESEARCH_ROUNDS);
  assert.ok(result.evidenceChunkCount >= MAX_TOPIC_RESEARCH_ROUNDS);
  assert.ok(result.searchQueryCount <= MAX_TOPIC_RESEARCH_ROUNDS * 4);
  assert.equal(result.stopReason, "max_rounds");
});

test("topic research reports safe persisted stages without exposing generated queries", async () => {
  const progress: Array<Record<string, unknown>> = [];
  await runBoundedTopicResearch({
    allowedTypes: ["system_topic"],
    concepts: [seed],
    knowledgeBundleId: "bundle-a",
    onProgress: (update) => { progress.push(update); },
    provider: {
      analyze: async () => ({ discoveries: [], meaningfulNewEvidence: false, proposals: [] }),
      plan: async () => ({ searchQuestions: ["private generated search question"], synonyms: [] }),
    },
    rerank: async ({ candidates }) => ({ results: candidates }),
    retrieve: async () => [chunk("safe-progress")],
    seed,
    workspaceId: "workspace-a",
  });

  assert.deepEqual(progress.map(({ stage }) => stage), [
    "planning_retrieval",
    "searching_sources",
    "reranking_evidence",
    "analyzing_evidence",
    "following_terminology",
  ]);
  assert.equal(progress.at(-1)?.completedRounds, 1);
  assert.equal(progress.at(-1)?.evidenceChunkCount, 1);
  assert.equal(JSON.stringify(progress).includes("private generated search question"), false);
});

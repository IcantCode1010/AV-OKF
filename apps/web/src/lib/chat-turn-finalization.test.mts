import assert from "node:assert/strict";
import test from "node:test";

import { finalizeChatTurn } from "./chat-turn-finalization.ts";
import type { ChatCitation } from "./chat-types.ts";

test("finalization persists only cited sources and remaps sparse markers", () => {
  const result = finalizeChatTurn({
    citations: [citation(1), citation(2), citation(3), citation(4)],
    content: "The answer is supported by the third result [3].",
    entityCandidates: [{
      citationIndex: 3,
      entityType: "system",
      evidenceQuote: "answer",
      id: "entity-1",
      name: "Generator",
      summary: "A generator.",
    }],
    outcome: "answered",
  });

  assert.equal(result.content, "The answer is supported by the third result [1].");
  assert.deepEqual(result.citations.map((item) => item.documentTitle), ["Source 3"]);
  assert.equal(result.relatedEvidence.length, 3);
  assert.equal(result.entityCandidates?.[0]?.citationIndex, 1);
  assert.deepEqual(result.citationProjection, {
    citedCount: 1,
    relatedCount: 3,
    remapped: true,
    retrievedCount: 4,
  });
});

test("insufficient evidence cannot retain answer citations", () => {
  const result = finalizeChatTurn({
    citations: [citation(1)],
    content: "The available material does not answer the question.",
    outcome: "insufficient_evidence",
  });

  assert.deepEqual(result.citations, []);
  assert.equal(result.relatedEvidence[0]?.reason, "related_not_answering");
  assert.equal(result.finalEvidenceStatus, "no_evidence");
  assert.deepEqual(result.finalSufficiency, {
    reason: "related_evidence_not_answering",
    status: "weak",
  });
});

function citation(index: number): ChatCitation {
  return {
    documentTitle: `Source ${index}`,
    index,
    pageEnd: index,
    pageStart: index,
    sourceType: "okf",
    text: `Evidence ${index}`,
  };
}

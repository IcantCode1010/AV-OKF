import assert from "node:assert/strict";
import test from "node:test";

import { validateDocumentRelationCandidateOutput } from "./okf-document-relation-candidates.ts";

const concepts = [
  {
    body: "The inspection procedure applies to the lift truck.",
    description: "Inspection scope.",
    filePath: "topic:procedure",
    title: "Inspection Procedure",
    type: "procedure",
  },
  {
    body: "The lift truck is industrial equipment.",
    description: "Equipment overview.",
    filePath: "topic:truck",
    title: "Lift Truck",
    type: "entity",
  },
];

test("document relation candidates accept only known pairs, vocabulary, and exact source evidence", () => {
  const result = validateDocumentRelationCandidateOutput({
    allowedRelations: ["applies_to"],
    concepts,
    output: {
      candidates: [
        {
          confidence: 0.96,
          direction: "proposed",
          evidenceQuote: "The inspection procedure applies to the lift truck.",
          rationale: "The procedure explicitly names its scope.",
          relation: "applies_to",
          sourceFile: "topic:procedure",
          targetFile: "topic:truck",
        },
        {
          confidence: 1,
          direction: "proposed",
          evidenceQuote: "fabricated quote",
          rationale: "Invalid evidence.",
          relation: "applies_to",
          sourceFile: "topic:procedure",
          targetFile: "topic:truck",
        },
        {
          confidence: 1,
          direction: "proposed",
          evidenceQuote: "The inspection procedure applies to the lift truck.",
          rationale: "Unknown target.",
          relation: "applies_to",
          sourceFile: "topic:procedure",
          targetFile: "topic:invented",
        },
      ],
    },
  });

  assert.equal(result.length, 1);
  assert.equal(result[0]?.relation, "applies_to");
  assert.deepEqual(result[0]?.signals, [
    "llm_document_local_candidate",
    "llm_candidate_confidence:0.960",
  ]);
});

test("reverse document relation evidence must exist in the reversed source", () => {
  const result = validateDocumentRelationCandidateOutput({
    allowedRelations: ["part_of"],
    concepts,
    output: {
      candidates: [{
        confidence: 0.9,
        direction: "reverse",
        evidenceQuote: "The lift truck is industrial equipment.",
        rationale: "The entity identifies its broader equipment class.",
        relation: "part_of",
        sourceFile: "topic:procedure",
        targetFile: "topic:truck",
      }],
    },
  });
  assert.equal(result[0]?.sourceFile, "topic:truck");
  assert.equal(result[0]?.targetFile, "topic:procedure");
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTHORING_CONCEPT_CONFIRMATION_THRESHOLD,
  AUTHORING_INPUT_TOKEN_CONFIRMATION_THRESHOLD,
  KNOWLEDGE_AUTHORING_OPERATIONS,
  normalizeMetadataProposal,
  normalizeAuthoringRelationSuggestions,
  parseTopicReference,
  requiresAuthoringCostConfirmation,
  validateAuthoringTopics,
} from "./knowledge-authoring.ts";
import { buildKnowledgeAuthoringJobId } from "./knowledge-authoring-queue.ts";

test("cost confirmation is required only above either threshold", () => {
  assert.equal(requiresAuthoringCostConfirmation({ conceptCount: 25, estimatedInputTokens: 250_000 }), false);
  assert.equal(requiresAuthoringCostConfirmation({ conceptCount: AUTHORING_CONCEPT_CONFIRMATION_THRESHOLD + 1, estimatedInputTokens: 1 }), true);
  assert.equal(requiresAuthoringCostConfirmation({ conceptCount: 1, estimatedInputTokens: AUTHORING_INPUT_TOKEN_CONFIRMATION_THRESHOLD + 1 }), true);
});

test("metadata proposals are trimmed, deduplicated, and preserve unknown values as null", () => {
  assert.deepEqual(normalizeMetadataProposal({
    classificationCode: "  SEC-14 ",
    description: "  General operations guide. ",
    documentType: " manual ",
    effectivity: null,
    rationale: [],
    revision: " ",
    sourceAuthority: " Manufacturer ",
    subjectFamily: " Vehicles ",
    tags: [" safety ", "safety", "operations"],
    title: "  Operations Manual ",
  }), {
    classificationCode: "SEC-14",
    description: "General operations guide.",
    documentType: "manual",
    effectivity: null,
    revision: null,
    sourceAuthority: "Manufacturer",
    subjectFamily: "Vehicles",
    tags: ["safety", "operations"],
    title: "Operations Manual",
  });
});

test("review validation identifies incomplete and unresolved topics", () => {
  const [valid, invalid] = validateAuthoringTopics([
    { enrichmentStatus: "completed", id: "topic-a", proposedSourcePageNumbers: [], sourcePageNumbers: [1], summary: "Summary", title: "Title" },
    { enrichmentStatus: "failed", id: "topic-b", proposedSourcePageNumbers: [3], sourcePageNumbers: [], summary: "", title: " " },
  ]);
  assert.deepEqual(valid, { errors: [], topicId: "topic-a", valid: true });
  assert.deepEqual(invalid.errors, ["title_required", "summary_required", "source_pages_required", "enrichment_failed", "proposed_source_pages_require_review"]);
  assert.equal(invalid.valid, false);
});

test("authoring operation registry cannot approve, export, mutate lifecycle, or delete", () => {
  const operations = KNOWLEDGE_AUTHORING_OPERATIONS.join(" ");
  for (const forbidden of ["approve", "export", "delete", "archive", "retract"]) {
    assert.equal(operations.includes(forbidden), false, `${forbidden} must remain outside agent authority`);
  }
});

test("authoring queue job identity is stable per durable run", () => {
  const payload = { documentId: "doc-a", runId: "run-a", workspaceId: "workspace-a" };
  assert.equal(buildKnowledgeAuthoringJobId(payload), "knowledge-authoring-run-a");
  assert.equal(buildKnowledgeAuthoringJobId(payload), buildKnowledgeAuthoringJobId(payload));
});

test("authoring relation suggestions remain topic references until review promotion", () => {
  assert.deepEqual(normalizeAuthoringRelationSuggestions([
    { evidenceQuote: "The source explicitly supports the target.", rationale: "Shared source.", relation: "supports", sourceFile: "topic:source", targetFile: "topic:target", reason: "Shared source.", signals: ["shared_source_file", 1] },
    { relation: "", sourceFile: "topic:bad", targetFile: "topic:target", reason: "Invalid", signals: [] },
  ]), [{ evidenceQuote: "The source explicitly supports the target.", rationale: "Shared source.", relation: "supports", sourceFile: "topic:source", targetFile: "topic:target", reason: "Shared source.", signals: ["shared_source_file"] }]);
  assert.equal(parseTopicReference("topic:source"), "source");
  assert.equal(parseTopicReference("concepts/source.md"), null);
});

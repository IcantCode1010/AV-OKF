import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEntityTopicRevisionHash,
  deriveEntityAliasStatus,
  deriveEntityRegistrationStatus,
  getEntityExtractionJsonSchema,
  MAX_ENTITY_RELATIONS_PER_EXPANSION,
  normalizeEntityName,
  validateGroundedEntityExtraction,
} from "./entity-graph.ts";

const chunk = {
  contentHash: "hash-1",
  id: "chunk-1",
  pageEnd: 12,
  pageStart: 12,
  sourcePageNumbers: [12],
  text: "The Flight Control Computer requires Standard ABC-12 before dispatch.",
  tokenCount: 14,
};

function assertStrictObjectSchemas(node: unknown): void {
  if (!node || typeof node !== "object") return;
  const record = node as Record<string, unknown>;
  if (record.type === "object" && record.properties && typeof record.properties === "object") {
    const keys = Object.keys(record.properties as Record<string, unknown>).sort();
    assert.deepEqual([...(record.required as string[] ?? [])].sort(), keys);
    assert.equal(record.additionalProperties, false);
  }
  for (const value of Object.values(record)) {
    if (Array.isArray(value)) value.forEach(assertStrictObjectSchemas);
    else assertStrictObjectSchemas(value);
  }
}

test("entity extraction output is compatible with strict provider schemas", () => {
  assertStrictObjectSchemas(getEntityExtractionJsonSchema());
});

test("entity names normalize deterministically", () => {
  assert.equal(normalizeEntityName(" Flight-Control  Computer "), "flight control computer");
  assert.equal(normalizeEntityName("ＡＢＣ–12"), "abc 12");
});

test("two independent documents register an unambiguous entity while aliases remain review-first", () => {
  assert.equal(deriveEntityRegistrationStatus({ ambiguousIdentity: false, independentDocumentCount: 1 }), "provisional");
  assert.equal(deriveEntityRegistrationStatus({ ambiguousIdentity: false, independentDocumentCount: 2 }), "auto_registered");
  assert.equal(deriveEntityRegistrationStatus({ ambiguousIdentity: true, independentDocumentCount: 2 }), "needs_review");
  assert.equal(deriveEntityAliasStatus({ alias: "Flight-Control Computer", canonicalName: "Flight Control Computer" }), "accepted");
  assert.equal(deriveEntityAliasStatus({ alias: "FCC", canonicalName: "Flight Control Computer" }), "needs_review");
});

test("grounded extraction accepts exact entities and explicit relation targets", () => {
  const result = validateGroundedEntityExtraction({
    allowedRelations: ["requires"],
    chunks: [chunk],
    output: {
      entities: [{ aliases: ["FCC"], ambiguousIdentity: false, ataChapter: null, classificationCode: null, chunkId: "chunk-1", confidence: 0.98, entityType: "system", evidenceQuote: "The Flight Control Computer requires Standard ABC-12 before dispatch.", identityContext: null, name: "Flight Control Computer", pageNumbers: [12], subjectFamily: null, systemFamily: null }],
      relations: [{ chunkId: "chunk-1", confidence: 0.97, evidenceQuote: "The Flight Control Computer requires Standard ABC-12 before dispatch.", pageNumbers: [12], rationale: "The Flight Control Computer explicitly requires Standard ABC-12 before dispatch.", relation: "requires", targetAnchor: null, targetName: "Standard ABC-12" }],
    },
  });
  assert.equal(result.entities.length, 1);
  assert.equal(result.relations.length, 1);
});

test("grounded extraction rejects fabricated, target-only, unknown-page, and unknown-relation evidence", () => {
  const result = validateGroundedEntityExtraction({
    allowedRelations: ["requires"],
    chunks: [chunk],
    output: {
      entities: [
        { aliases: [], ambiguousIdentity: false, ataChapter: null, classificationCode: null, chunkId: "chunk-1", confidence: 1, entityType: "system", evidenceQuote: "A different computer exists.", identityContext: null, name: "Different Computer", pageNumbers: [12], subjectFamily: null, systemFamily: null },
        { aliases: [], ambiguousIdentity: false, ataChapter: null, classificationCode: null, chunkId: "chunk-1", confidence: 1, entityType: "standard", evidenceQuote: "The Flight Control Computer requires Standard ABC-12 before dispatch.", identityContext: null, name: "Standard ABC-12", pageNumbers: [99], subjectFamily: null, systemFamily: null },
      ],
      relations: [
        { chunkId: "chunk-1", confidence: 1, evidenceQuote: "The Flight Control Computer requires Standard ABC-12 before dispatch.", pageNumbers: [12], rationale: "The source and target are directly connected by the requirement statement.", relation: "invented_relation", targetAnchor: null, targetName: "Standard ABC-12" },
        { chunkId: "chunk-1", confidence: 1, evidenceQuote: "The Flight Control Computer requires Standard ABC-12 before dispatch.", pageNumbers: [12], rationale: "The source and target are directly connected by the requirement statement.", relation: "requires", targetAnchor: null, targetName: "Unmentioned Target" },
      ],
    },
  });
  assert.deepEqual(result, { entities: [], relations: [] });
});

test("a unique target anchor can ground a relation without a target name", () => {
  const result = validateGroundedEntityExtraction({
    allowedRelations: ["references"],
    chunks: [{ ...chunk, text: "For details, refer to section 52-61-0." }],
    output: {
      entities: [],
      relations: [{ chunkId: "chunk-1", confidence: 0.99, evidenceQuote: "For details, refer to section 52-61-0.", pageNumbers: [12], rationale: "The current procedure explicitly directs the reader to the uniquely identified section 52-61-0.", relation: "references", targetAnchor: "52-61-0", targetName: null }],
    },
  });
  assert.equal(result.relations.length, 1);
});

test("topic revision hashes change with content or authoritative pages", () => {
  const base = { enrichedBody: "Body", enrichedSummary: "Summary", enrichedTitle: "Title", sourcePageNumbers: [1, 2] };
  assert.equal(buildEntityTopicRevisionHash(base), buildEntityTopicRevisionHash({ ...base, sourcePageNumbers: [2, 1] }));
  assert.notEqual(buildEntityTopicRevisionHash(base), buildEntityTopicRevisionHash({ ...base, enrichedBody: "Changed" }));
  assert.notEqual(buildEntityTopicRevisionHash(base), buildEntityTopicRevisionHash({ ...base, sourcePageNumbers: [1, 2, 3] }));
  assert.equal(MAX_ENTITY_RELATIONS_PER_EXPANSION, 50);
});

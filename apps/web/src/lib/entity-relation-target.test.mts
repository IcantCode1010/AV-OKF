import assert from "node:assert/strict";
import test from "node:test";
import { resolveEntityRelationTarget, type RelationTargetTopic } from "./entity-relation-target.ts";

const topic = (id: string, title: string, body = ""): RelationTargetTopic => ({ id, title, enrichedTitle: null, enrichedSummary: null, enrichedBody: body, summary: "", okfMetadata: {}, exportedFilePath: `${id}.md` });
const assertion = { sourceTopicId: "source", targetAnchor: null, targetResolutionValue: "supply circuit", evidenceQuote: "The supply circuit feeds the actuator." };

test("an explicit name inside a unique longer heading is a verification candidate", () => {
  const result = resolveEntityRelationTarget({ aliases: [], assertion, topics: [topic("target", "Supply circuit — description and operation")] });
  assert.equal(result.target?.id, "target");
  assert.equal("strategy" in result && result.strategy, "unique_title_phrase");
});

test("anchor references in the source do not make the destination ambiguous", () => {
  const result = resolveEntityRelationTarget({ aliases: [], assertion: { ...assertion, targetAnchor: "TASK 32-10-01" }, topics: [
    topic("source", "Control", "Refer to TASK 32-10-01."), topic("target", "Procedure", "TASK 32-10-01 describes the procedure."),
  ] });
  assert.equal(result.target?.id, "target");
  assert.equal("strategy" in result && result.strategy, "unique_anchor");
});

test("ambiguous heading matches and body-only mentions stay unresolved", () => {
  const ambiguous = resolveEntityRelationTarget({ aliases: [], assertion, topics: [topic("one", "Supply circuit testing"), topic("two", "Supply circuit inspection")] });
  assert.deepEqual(ambiguous, { target: null, reason: "ambiguous_target" });
  assert.equal(resolveEntityRelationTarget({ aliases: [], assertion, topics: [topic("one", "Other topic", assertion.evidenceQuote)] }).target, null);
});

test("a unique accepted alias resolves with accurate provenance", () => {
  const result = resolveEntityRelationTarget({ assertion, topics: [topic("target", "Hydraulics")], aliases: [{ normalizedValue: "supply circuit", entity: { topicLinks: [{ topicId: "target" }] } }] });
  assert.equal(result.target?.id, "target");
  assert.equal("strategy" in result && result.strategy, "accepted_alias");
});

test("self references, unquoted phrases, and unpublished destinations are not guessed", () => {
  assert.equal(resolveEntityRelationTarget({ aliases: [], assertion, topics: [topic("source", "Supply circuit")] }).target, null);
  assert.equal(resolveEntityRelationTarget({ aliases: [], assertion: { ...assertion, evidenceQuote: "Something else" }, topics: [topic("target", "Supply circuit overview")] }).target, null);
  assert.equal(resolveEntityRelationTarget({ aliases: [], assertion, topics: [{ ...topic("target", "Supply circuit"), exportedFilePath: null }] }).target, null);
});

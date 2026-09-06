import assert from "node:assert/strict";
import test from "node:test";

import { buildTopicExpansionJobId, ensureTopicExpansionJobQueued } from "./topic-expansion-queue.ts";
import { isTopicExpansionRunExecutable, MAX_TOPIC_EXPANSION_PROPOSALS, mergeExpansionCandidates, rankExpansionCandidates, validateExpansionCandidate, type ExpansionConcept, type ValidatedTopicExpansionCandidate } from "./topic-expansion.ts";

function concept(overrides: Partial<ExpansionConcept> = {}): ExpansionConcept {
  return {
    approvalMode: "human_individual",
    body: "Approved article.",
    chunks: [{ contentHash: "chunk-hash", documentId: "doc-a", id: "chunk-a", pages: [12], text: "The hydraulic power transfer unit supplies alternate pressure." }],
    contentHash: "concept-hash",
    documentId: "doc-a",
    entityNames: ["Hydraulic Power Transfer Unit"],
    filePath: "concepts/system/ptu.md",
    id: "topic-a",
    title: "Hydraulic overview",
    topicType: "system_topic",
    trustTier: "human",
    ...overrides,
  };
}

test("one approved concept qualifies only through a substantive registered entity", () => {
  const valid = validateExpansionCandidate({
    allowedTypes: ["system_topic"],
    concepts: [concept()],
    proposal: {
      confidence: 0.9,
      evidence: [{ chunkId: "chunk-a", evidenceQuote: "The hydraulic power transfer unit supplies alternate pressure.", sourceTopicId: "topic-a" }],
      rationale: "The Hydraulic Power Transfer Unit is discussed as a distinct operating subject that lacks its own approved concept.",
      summary: "A dedicated explanation of hydraulic power transfer unit operation.",
      title: "Hydraulic Power Transfer Unit",
      topicType: "system_topic",
    },
  });
  assert.ok(valid);
  const rejected = validateExpansionCandidate({
    allowedTypes: ["system_topic"],
    concepts: [concept({ entityNames: [] })],
    proposal: {
      confidence: 0.9,
      evidence: [{ chunkId: "chunk-a", evidenceQuote: "The hydraulic power transfer unit supplies alternate pressure.", sourceTopicId: "topic-a" }],
      rationale: "This text names a possible subject, but it has no independent registry support for one-source promotion.",
      summary: "A dedicated explanation of hydraulic power transfer unit operation.",
      title: "Hydraulic Power Transfer Unit",
      topicType: "system_topic",
    },
  });
  assert.equal(rejected, null);
});

test("two approved concepts qualify with exact raw quotes", () => {
  const second = concept({ chunks: [{ contentHash: "chunk-b-hash", documentId: "doc-b", id: "chunk-b", pages: [4], text: "Alternate pressure is provided by the hydraulic power transfer unit." }], documentId: "doc-b", entityNames: [], filePath: "concepts/system/alternate.md", id: "topic-b" });
  const result = validateExpansionCandidate({
    allowedTypes: ["system_topic"],
    concepts: [concept({ entityNames: [] }), second],
    proposal: {
      confidence: 0.8,
      evidence: [
        { chunkId: "chunk-a", evidenceQuote: "The hydraulic power transfer unit supplies alternate pressure.", sourceTopicId: "topic-a" },
        { chunkId: "chunk-b", evidenceQuote: "Alternate pressure is provided by the hydraulic power transfer unit.", sourceTopicId: "topic-b" },
      ],
      rationale: "Both approved concepts identify hydraulic power transfer as a recurring subject separate from their current articles.",
      summary: "How the power transfer function supplies alternate hydraulic pressure.",
      title: "Hydraulic Power Transfer",
      topicType: "system_topic",
    },
  });
  assert.equal(result?.evidence.length, 2);
});

test("altered and unknown evidence fail closed", () => {
  const base = { confidence: 0.8, rationale: "The proposed subject is directly supported and separately identifiable in both approved source concepts.", summary: "A separately grounded operational subject from approved source material.", title: "Hydraulic Power Transfer Unit", topicType: "system_topic" };
  assert.equal(validateExpansionCandidate({ allowedTypes: ["system_topic"], concepts: [concept()], proposal: { ...base, evidence: [{ chunkId: "chunk-a", evidenceQuote: "Fabricated pressure statement.", sourceTopicId: "topic-a" }] } }), null);
  assert.equal(validateExpansionCandidate({ allowedTypes: ["system_topic"], concepts: [concept()], proposal: { ...base, evidence: [{ chunkId: "unknown", evidenceQuote: "The hydraulic power transfer unit supplies alternate pressure.", sourceTopicId: "topic-a" }] } }), null);
});

test("ranking favors independent concepts, documents, and human trust", () => {
  const candidate = (name: string, evidence: ValidatedTopicExpansionCandidate["evidence"]): ValidatedTopicExpansionCandidate => ({ confidence: 0.9, evidence, identityFingerprint: name, normalizedTitle: name, rationale: "A sufficiently detailed rationale identifying a missing grounded topic.", summary: "Grounded topic summary.", title: name, topicType: "system_topic" });
  const evidence = (sourceTopicId: string, documentId: string, trustTier: string) => ({ chunkContentHash: "c", chunkId: `${sourceTopicId}-chunk`, conceptContentHash: "o", documentId, evidenceQuote: "quote", sourceFilePath: `${sourceTopicId}.md`, sourcePages: [1], sourceTopicId, trustTier });
  const ranked = rankExpansionCandidates([
    candidate("single", [evidence("a", "doc-a", "human")]),
    candidate("multi", [evidence("a", "doc-a", "automated"), evidence("b", "doc-b", "automated")]),
  ]);
  assert.equal(ranked[0]?.title, "multi");
  assert.equal(MAX_TOPIC_EXPANSION_PROPOSALS, 10);
});

test("topic expansion queue IDs are deterministic and reject unsafe identities", () => {
  assert.equal(buildTopicExpansionJobId({ kind: "crawl", runId: "run_1", workspaceId: "ws" }), "topic-expansion-crawl-run_1");
  assert.equal(buildTopicExpansionJobId({ kind: "research", jobId: "research_1", workspaceId: "ws" }), "topic-expansion-research-research_1");
  assert.throws(() => buildTopicExpansionJobId({ kind: "enrich", jobId: "bad:id", workspaceId: "ws" }), /identity_invalid/);
});

test("per-topic discoveries merge evidence before the 10-topic critic cap", () => {
  const base = validateExpansionCandidate({
    allowedTypes: ["system_topic"],
    concepts: [concept()],
    proposal: {
      confidence: 0.8,
      evidence: [{ chunkId: "chunk-a", evidenceQuote: "The hydraulic power transfer unit supplies alternate pressure.", sourceTopicId: "topic-a" }],
      rationale: "The Hydraulic Power Transfer Unit is a distinct subject explicitly discussed by the approved hydraulic concept.",
      summary: "A dedicated explanation of hydraulic power transfer unit operation.",
      title: "Hydraulic Power Transfer Unit",
      topicType: "system_topic",
    },
  });
  assert.ok(base);
  const merged = mergeExpansionCandidates([base, { ...base, confidence: 0.95, rationale: `${base.rationale} Additional support was found.` }]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.confidence, 0.95);
  assert.equal(merged[0]?.evidence.length, 1);
});

test("stale queue jobs cannot bypass topic expansion confirmation", () => {
  assert.equal(isTopicExpansionRunExecutable("awaiting_confirmation"), false);
  assert.equal(isTopicExpansionRunExecutable("cancelled"), false);
  assert.equal(isTopicExpansionRunExecutable("awaiting_provider"), false);
  assert.equal(isTopicExpansionRunExecutable("failed"), false);
  assert.equal(isTopicExpansionRunExecutable("completed"), false);
  assert.equal(isTopicExpansionRunExecutable("queued"), true);
  assert.equal(isTopicExpansionRunExecutable("running"), true);
});

test("topic expansion retries replace terminal deterministic BullMQ jobs", async () => {
  const events: string[] = [];
  const result = await ensureTopicExpansionJobQueued({
    add: async () => { events.push("added"); },
    getExisting: async () => ({
      getState: async () => "failed",
      remove: async () => { events.push("removed"); },
    }),
  });
  assert.equal(result, "replaced");
  assert.deepEqual(events, ["removed", "added"]);

  const activeEvents: string[] = [];
  assert.equal(await ensureTopicExpansionJobQueued({
    add: async () => { activeEvents.push("added"); },
    getExisting: async () => ({ getState: async () => "active", remove: async () => { activeEvents.push("removed"); } }),
  }), "existing");
  assert.deepEqual(activeEvents, []);
});

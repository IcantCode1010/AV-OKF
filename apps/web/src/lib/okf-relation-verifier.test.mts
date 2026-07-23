import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRelationVerifierConcept,
  canonicalizeRelationEvidenceText,
  OkfRelationVerifierError,
  validateRelationVerifierDecision,
  verifyOkfRelationCandidate,
} from "./okf-relation-verifier.ts";

const source = buildRelationVerifierConcept({
  body: "Use checklist A before starting.\r\n  Verify   pressure is stable.",
  description: "Start requirements",
  filePath: "concepts/start.md",
  title: "Starting",
});
const target = buildRelationVerifierConcept({
  body: "Checklist A contains the inspection sequence.",
  filePath: "concepts/checklist.md",
  title: "Checklist A",
});

test("canonical relation evidence normalizes extraction whitespace without changing case or punctuation", () => {
  assert.equal(
    canonicalizeRelationEvidenceText("A\r\n\u200b  B\tC!"),
    "A B C!",
  );
  assert.equal(source.canonicalText.includes("Verify pressure is stable."), true);
});

test("positive verification requires an exact quote from the selected source", () => {
  const base = {
    confidence: 0.91,
    direction: "proposed" as const,
    evidenceQuote: "Use checklist A before starting.",
    rationale: "The source explicitly invokes the target checklist.",
    related: true,
    relation: "references",
  };
  assert.equal(validateRelationVerifierDecision({ allowedRelations: ["references"], decision: base, proposedSource: source, proposedTarget: target }).relation, "references");
  assert.throws(() => validateRelationVerifierDecision({
    allowedRelations: ["references"],
    decision: { ...base, evidenceQuote: "use checklist A before starting." },
    proposedSource: source,
    proposedTarget: target,
  }), /relation_verification_evidence_not_in_source/);
  assert.throws(() => validateRelationVerifierDecision({
    allowedRelations: ["references"],
    decision: { ...base, evidenceQuote: "Checklist A contains the inspection sequence." },
    proposedSource: source,
    proposedTarget: target,
  }), /relation_verification_evidence_not_in_source/);
});

test("reverse direction validates evidence against the reversed source", () => {
  const decision = validateRelationVerifierDecision({
    allowedRelations: ["supports"],
    decision: {
      confidence: 0.8,
      direction: "reverse",
      evidenceQuote: "Checklist A contains the inspection sequence.",
      rationale: "The checklist supports the start concept.",
      related: true,
      relation: "supports",
    },
    proposedSource: source,
    proposedTarget: target,
  });
  assert.equal(decision.direction, "reverse");
});

test("verifier sends exactly one supplied pair and rejects vocabulary expansion", async () => {
  let providerPrompt = "";
  const result = await verifyOkfRelationCandidate({
    allowedRelations: ["references"],
    proposedRelation: "references",
    proposedSource: source,
    proposedTarget: target,
    signals: ["shared_source_file", "matched_term:checklist"],
    workspaceId: "workspace-1",
  }, {
    callProvider: async (input) => {
      providerPrompt = input.prompt;
      return {
        confidence: 0.88,
        direction: "proposed",
        evidenceQuote: "Use checklist A before starting.",
        rationale: "Direct reference.",
        related: true,
        relation: "references",
      };
    },
    getApiKey: async () => ({ apiKey: "test-key", provider: "openai" }),
  });
  const parsedPrompt = JSON.parse(providerPrompt);
  assert.equal(parsedPrompt.candidate.proposedSourceFile, source.filePath);
  assert.equal(parsedPrompt.candidate.proposedTargetFile, target.filePath);
  assert.equal("candidates" in parsedPrompt, false);
  assert.equal(result.decision.related, true);

  await assert.rejects(() => verifyOkfRelationCandidate({
    allowedRelations: ["references"],
    proposedRelation: "references",
    proposedSource: source,
    proposedTarget: target,
    signals: [],
    workspaceId: "workspace-1",
  }, {
    callProvider: async () => ({ confidence: 1, direction: "proposed", evidenceQuote: "Use checklist A before starting.", rationale: "Invented type.", related: true, relation: "owns" }),
    getApiKey: async () => ({ apiKey: "test-key", provider: "openai" }),
  }), /relation_verification_relation_not_allowed/);
});

test("negative verifier decisions remain valid without evidence", () => {
  const decision = validateRelationVerifierDecision({
    allowedRelations: ["references"],
    decision: { confidence: 0.12, direction: null, evidenceQuote: null, rationale: "No direct relation.", related: false, relation: null },
    proposedSource: source,
    proposedTarget: target,
  });
  assert.equal(decision.related, false);
});

test("application-rejected provider output retains prompt and raw response for audit", async () => {
  await assert.rejects(
    () => verifyOkfRelationCandidate({
      allowedRelations: ["references"],
      proposedRelation: "references",
      proposedSource: source,
      proposedTarget: target,
      signals: [],
      workspaceId: "workspace-1",
    }, {
      callProvider: async () => ({ confidence: 0.7, direction: "proposed", evidenceQuote: "fabricated", rationale: "Invalid evidence.", related: true, relation: "references" }),
      getApiKey: async () => ({ apiKey: "test-key", provider: "openai" }),
    }),
    (error) => {
      assert.equal(error instanceof OkfRelationVerifierError, true);
      const verifierError = error as OkfRelationVerifierError;
      assert.equal(verifierError.message, "relation_verification_evidence_not_in_source");
      assert.match(verifierError.audit.promptSent, /concepts\/start\.md/);
      assert.match(verifierError.audit.rawResponse ?? "", /fabricated/);
      return true;
    },
  );
});

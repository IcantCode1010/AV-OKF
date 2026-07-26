import assert from "node:assert/strict";
import test from "node:test";

import {
  compareAdaptiveEvaluationModes,
  scoreAdaptiveEvaluationTrial,
  summarizeAdaptiveEvaluationMode,
  validateAdaptiveEvaluationCases,
  type AdaptiveEvaluationCase,
  type AdaptiveEvaluationTrial,
} from "./adaptive-retrieval-evaluation.ts";
import { ADAPTIVE_EVALUATION_CASES } from "./adaptive-retrieval-evaluation-corpus.ts";
import { routeChatQuestion } from "./chat-router.ts";

test("committed corpus contains the required fixed domain and origin split", () => {
  assert.deepEqual(validateAdaptiveEvaluationCases(ADAPTIVE_EVALUATION_CASES), []);
});

test("every committed case enters its declared deterministic route", () => {
  for (const definition of ADAPTIVE_EVALUATION_CASES) {
    assert.equal(
      routeChatQuestion(definition.query).route,
      definition.expectedRoute,
      definition.id,
    );
  }
});

function evaluationCase(
  overrides: Partial<AdaptiveEvaluationCase> = {},
): AdaptiveEvaluationCase {
  return {
    allowedCitationTargets: ["concepts/procedure/alpha.md", "Raw Alpha"],
    bundleSlug: "bundle-alpha",
    domain: "equipment_operations",
    expectedInitialSufficiency: "weak",
    expectedRetryEligible: true,
    expectedRoute: "okf_only",
    forbiddenCitationTargets: ["concepts/procedure/retracted.md"],
    id: "alpha",
    origin: "synthetic",
    protectedIdentifiers: [],
    query: "What is the approved alpha procedure?",
    requiredCitationTargets: ["concepts/procedure/alpha.md"],
    ...overrides,
  };
}

test("case validation enforces the fixed 30-question matrix", () => {
  const domains = [
    "equipment_operations",
    "software_security",
    "workplace_policy",
    "finance_compliance",
    "general_operations",
  ] as const;
  const cases = domains.flatMap((domain, domainIndex) =>
    Array.from({ length: 6 }, (_, index) =>
      evaluationCase({
        domain,
        expectedInitialSufficiency: index < 3 ? "weak" : "partial",
        expectedRoute: index < 3 ? "okf_only" : "hybrid",
        id: `${domain}-${index}`,
        origin: domainIndex === 0 ? "sanitized_real" : "synthetic",
      })
    )
  );

  assert.deepEqual(validateAdaptiveEvaluationCases(cases), []);
  assert.ok(
    validateAdaptiveEvaluationCases(cases.slice(0, 29)).some((error) =>
      error.startsWith("expected_30_cases:")
    ),
  );
});

test("trial scoring requires expected citations, stable scope, and validation", () => {
  const entry = evaluationCase();
  const passing = scoreAdaptiveEvaluationTrial({
    caseDefinition: entry,
    citations: [{
      knowledgeBundleId: "bundle-1",
      sourceType: "okf",
      target: "concepts/procedure/alpha.md",
    }],
    expectedBundleIds: ["bundle-1"],
    mode: "candidate",
    trace: {
      adaptiveRetry: {
        eligible: true,
        enabledBundleIds: ["bundle-1"],
        evidenceDelta: { approvedOkf: 1, citations: 1, rawRag: 0 },
        fallbackUsed: false,
        originalSufficiency: { reason: "weak", status: "weak" },
        outcome: "applied",
      },
      answerEvidenceTrustLevel: "high",
      answerValidationStatus: "pass",
      evidenceSufficiency: { status: "strong" },
      route: "okf_only",
      selectedBundleIds: ["bundle-1"],
    },
  });
  assert.equal(passing.correct, true);

  const failing = scoreAdaptiveEvaluationTrial({
    caseDefinition: entry,
    citations: [{
      knowledgeBundleId: "bundle-2",
      sourceType: "rag",
      target: "Unexpected Raw",
    }],
    expectedBundleIds: ["bundle-1"],
    mode: "candidate",
    trace: {
      adaptiveRetry: {
        eligible: true,
        enabledBundleIds: ["bundle-1"],
        evidenceDelta: { approvedOkf: 0, citations: 0, rawRag: 0 },
        fallbackUsed: true,
        originalSufficiency: { reason: "weak", status: "weak" },
        outcome: "no_improvement",
      },
      answerEvidenceTrustLevel: "high",
      answerValidationStatus: "fail",
      evidenceSufficiency: { reason: "weak", status: "weak" },
      route: "hybrid",
      selectedBundleIds: ["bundle-2"],
    },
  });
  assert.equal(failing.correct, false);
  assert.ok(failing.policyViolations.includes("bundle_scope_changed"));
  assert.ok(failing.policyViolations.includes("raw_rag_trust_upgrade"));
  assert.ok(failing.qualityFailures.includes("answer_validation_fail"));
});

test("quality failures do not masquerade as policy violations", () => {
  const scored = scoreAdaptiveEvaluationTrial({
    caseDefinition: evaluationCase(),
    citations: [],
    expectedBundleIds: ["bundle-1"],
    mode: "candidate",
    trace: {
      adaptiveRetry: {
        eligible: false,
        enabledBundleIds: ["bundle-1"],
        evidenceDelta: { approvedOkf: 0, citations: 0, rawRag: 0 },
        fallbackUsed: false,
        originalSufficiency: { reason: "no evidence", status: "none" },
        outcome: "not_eligible",
      },
      answerValidationStatus: "fail",
      evidenceSufficiency: { reason: "no evidence", status: "none" },
      route: "okf_only",
      selectedBundleIds: ["bundle-1"],
    },
  });

  assert.deepEqual(scored.policyViolations, []);
  assert.deepEqual(scored.qualityFailures, [
    "initial_sufficiency_changed:weak->none",
    "retry_eligibility_mismatch",
    "answer_validation_fail",
  ]);
  assert.equal(scored.correct, false);
});

test("mode summary uses two-of-three majority and calculates metrics", () => {
  const cases = [evaluationCase()];
  const trials = [
    trial("baseline", 1, true, 100),
    trial("baseline", 2, true, 200),
    trial("baseline", 3, false, 300),
  ];
  const summary = summarizeAdaptiveEvaluationMode(cases, trials, "baseline");

  assert.equal(summary.correctQuestionCount, 1);
  assert.equal(summary.correctTrialCount, 2);
  assert.equal(summary.citationPrecision, 1);
  assert.equal(summary.citationRecall, 1);
  assert.deepEqual(summary.latencyMs, { p50: 200, p95: 300 });
});

test("comparison blocks regressions and requires a three-question gain", () => {
  const baseline = summaryFor(["a", "b"], "baseline");
  const candidate = summaryFor(["a", "c", "d", "e", "f"], "candidate");
  const comparison = compareAdaptiveEvaluationModes({
    baseline,
    candidate,
    environmentValid: true,
    humanReviewPassed: true,
    routeSuitePassed: true,
  });

  assert.equal(comparison.questionGain, 3);
  assert.deepEqual(comparison.regressionIds, ["b"]);
  assert.equal(comparison.decision, "hold_for_tuning");
  assert.equal(comparison.gates.noBaselineRegressions, false);
});

function trial(
  mode: "baseline" | "candidate",
  trialNumber: number,
  correct: boolean,
  latencyMs: number,
): AdaptiveEvaluationTrial {
  return {
    answerContent: "Answer **1**.",
    answerValidationStatus: "pass",
    citationTargetsFound: ["concepts/procedure/alpha.md"],
    citations: [{
      sourceType: "okf",
      target: "concepts/procedure/alpha.md",
    }],
    correct,
    expectedCitationTargets: ["concepts/procedure/alpha.md"],
    id: "alpha",
    latencyMs,
    mode,
    policyViolations: correct ? [] : ["test_failure"],
    qualityFailures: [],
    route: "okf_only",
    selectedBundleIds: ["bundle-1"],
    trial: trialNumber,
  };
}

function summaryFor(
  correctIds: string[],
  mode: "baseline" | "candidate",
) {
  return {
    answerValidationPassRate: 1,
    citationPrecision: 1,
    citationRecall: 1,
    correctQuestionCount: correctIds.length,
    correctTrialCount: correctIds.length * 3,
    fallbackRate: 0,
    inputTokens: 0,
    latencyMs: { p50: 1, p95: 2 },
    mode,
    outputTokens: 0,
    policyViolationCount: 0,
    qualityFailureCount: 0,
    providerCallCount: 0,
    questionResults: ["a", "b", "c", "d", "e", "f"].map((id) => ({
      correct: correctIds.includes(id),
      correctTrialCount: correctIds.includes(id) ? 3 : 0,
      domain: "equipment_operations" as const,
      id,
    })),
    totalTokens: 0,
    totalTrials: 18,
  };
}

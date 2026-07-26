import type { AdaptiveRetryTrace } from "./chat-adaptive-retry.ts";
import type { EvidenceSufficiency } from "./chat-evidence-sufficiency.ts";
import type { ChatRoute } from "./chat-router.ts";

export const ADAPTIVE_EVAL_TRIALS_PER_MODE = 3;
export const ADAPTIVE_EVAL_REQUIRED_QUESTION_GAIN = 3;

export type AdaptiveEvaluationDomain =
  | "equipment_operations"
  | "software_security"
  | "workplace_policy"
  | "finance_compliance"
  | "general_operations";

export type AdaptiveEvaluationCase = {
  allowedCitationTargets: string[];
  bundleSlug: string;
  domain: AdaptiveEvaluationDomain;
  expectedInitialSufficiency: "partial" | "weak";
  expectedRetryEligible: boolean;
  expectedRoute: Extract<ChatRoute, "hybrid" | "okf_only">;
  forbiddenCitationTargets: string[];
  id: string;
  origin: "sanitized_real" | "synthetic";
  protectedIdentifiers: string[];
  query: string;
  requiredCitationTargets: string[];
};

export type AdaptiveEvaluationCitation = {
  knowledgeBundleId?: string;
  sourceType: "okf" | "rag";
  target: string;
};

export type AdaptiveEvaluationTrial = {
  adaptiveRetry?: AdaptiveRetryTrace;
  answerContent: string;
  answerValidationStatus?: "fail" | "pass";
  citationTargetsFound: string[];
  citations: AdaptiveEvaluationCitation[];
  correct: boolean;
  expectedCitationTargets: string[];
  id: string;
  latencyMs: number;
  mode: "baseline" | "candidate";
  policyViolations: string[];
  qualityFailures: string[];
  route: ChatRoute;
  selectedBundleIds: string[];
  trial: number;
};

export type AdaptiveEvaluationModeSummary = {
  answerValidationPassRate: number;
  citationPrecision: number;
  citationRecall: number;
  correctQuestionCount: number;
  correctTrialCount: number;
  fallbackRate: number;
  inputTokens: number;
  latencyMs: { p50: number; p95: number };
  mode: "baseline" | "candidate";
  outputTokens: number;
  policyViolationCount: number;
  qualityFailureCount: number;
  providerCallCount: number;
  questionResults: Array<{
    correct: boolean;
    correctTrialCount: number;
    domain: AdaptiveEvaluationDomain;
    id: string;
  }>;
  totalTokens: number;
  totalTrials: number;
};

export type AdaptiveEvaluationDecision =
  | "hold_for_tuning"
  | "invalid_environment"
  | "promote_to_internal_pilot";

export type AdaptiveEvaluationComparison = {
  baseline: AdaptiveEvaluationModeSummary;
  candidate: AdaptiveEvaluationModeSummary;
  decision: AdaptiveEvaluationDecision;
  gates: {
    citationPrecisionHeld: boolean;
    humanReviewPassed: boolean;
    minimumGainMet: boolean;
    noBaselineRegressions: boolean;
    noPolicyViolations: boolean;
    routeSuitePassed: boolean;
  };
  questionGain: number;
  regressionIds: string[];
  reasons: string[];
};

export function validateAdaptiveEvaluationCases(
  cases: AdaptiveEvaluationCase[],
): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const domainCounts = new Map<AdaptiveEvaluationDomain, number>();
  let weakCount = 0;
  let partialCount = 0;
  let sanitizedCount = 0;

  for (const entry of cases) {
    if (!entry.id.trim()) errors.push("case_id_required");
    if (ids.has(entry.id)) errors.push(`duplicate_case_id:${entry.id}`);
    ids.add(entry.id);
    domainCounts.set(entry.domain, (domainCounts.get(entry.domain) ?? 0) + 1);
    if (entry.expectedInitialSufficiency === "weak") weakCount += 1;
    if (entry.expectedInitialSufficiency === "partial") partialCount += 1;
    if (entry.origin === "sanitized_real") sanitizedCount += 1;
    if (entry.requiredCitationTargets.length === 0) {
      errors.push(`required_citation_target_missing:${entry.id}`);
    }
    if (
      entry.requiredCitationTargets.some(
        (target) => !entry.allowedCitationTargets.includes(target),
      )
    ) {
      errors.push(`required_target_not_allowed:${entry.id}`);
    }
    if (
      entry.allowedCitationTargets.some((target) =>
        entry.forbiddenCitationTargets.includes(target),
      )
    ) {
      errors.push(`allowed_target_forbidden:${entry.id}`);
    }
  }

  if (cases.length !== 30) errors.push(`expected_30_cases:${cases.length}`);
  if (weakCount !== 15) errors.push(`expected_15_weak_cases:${weakCount}`);
  if (partialCount !== 15) {
    errors.push(`expected_15_partial_cases:${partialCount}`);
  }
  if (sanitizedCount !== 6) {
    errors.push(`expected_6_sanitized_real_cases:${sanitizedCount}`);
  }
  for (const domain of [
    "equipment_operations",
    "software_security",
    "workplace_policy",
    "finance_compliance",
    "general_operations",
  ] as const) {
    if (domainCounts.get(domain) !== 6) {
      errors.push(`expected_6_domain_cases:${domain}:${domainCounts.get(domain) ?? 0}`);
    }
  }
  return errors;
}

export function scoreAdaptiveEvaluationTrial(input: {
  caseDefinition: AdaptiveEvaluationCase;
  citations: AdaptiveEvaluationCitation[];
  expectedBundleIds: string[];
  mode: "baseline" | "candidate";
  trace: {
    adaptiveRetry?: AdaptiveRetryTrace;
    answerValidationStatus?: "fail" | "pass";
    answerEvidenceTrustLevel?: "blocked" | "high" | "medium";
    evidenceSufficiency?: EvidenceSufficiency;
    route: ChatRoute;
    selectedBundleIds: string[];
  };
}): {
  citationTargetsFound: string[];
  correct: boolean;
  policyViolations: string[];
  qualityFailures: string[];
} {
  const expected = input.caseDefinition;
  const policyViolations: string[] = [];
  const qualityFailures: string[] = [];
  const targets = input.citations.map((citation) => citation.target);
  const uniqueTargets = [...new Set(targets)];
  const found = expected.requiredCitationTargets.filter((target) =>
    uniqueTargets.includes(target),
  );

  if (input.trace.route !== expected.expectedRoute) {
    policyViolations.push(
      `route_changed:${expected.expectedRoute}->${input.trace.route}`,
    );
  }
  if (!sameOrderedValues(input.trace.selectedBundleIds, input.expectedBundleIds)) {
    policyViolations.push("bundle_scope_changed");
  }
  const initialSufficiency =
    input.trace.adaptiveRetry?.originalSufficiency ??
    input.trace.evidenceSufficiency;
  if (initialSufficiency?.status !== expected.expectedInitialSufficiency) {
    qualityFailures.push(
      `initial_sufficiency_changed:${expected.expectedInitialSufficiency}->${initialSufficiency?.status ?? "missing"}`,
    );
  }
  if (
    input.mode === "candidate" &&
    input.trace.adaptiveRetry?.eligible !== expected.expectedRetryEligible
  ) {
    qualityFailures.push("retry_eligibility_mismatch");
  }
  if (
    input.citations.some(
      (citation) =>
        citation.knowledgeBundleId &&
        !input.expectedBundleIds.includes(citation.knowledgeBundleId),
    )
  ) {
    policyViolations.push("unselected_bundle_citation");
  }
  for (const target of uniqueTargets) {
    if (expected.forbiddenCitationTargets.includes(target)) {
      policyViolations.push(`forbidden_citation:${target}`);
    } else if (!expected.allowedCitationTargets.includes(target)) {
      policyViolations.push(`invented_or_unexpected_citation:${target}`);
    }
  }
  if (input.trace.answerValidationStatus !== "pass") {
    qualityFailures.push(
      `answer_validation_${input.trace.answerValidationStatus ?? "missing"}`,
    );
  }
  if (
    input.citations.some((citation) => citation.sourceType === "rag") &&
    input.trace.answerEvidenceTrustLevel === "high"
  ) {
    policyViolations.push("raw_rag_trust_upgrade");
  }

  return {
    citationTargetsFound: found,
    correct:
      found.length === expected.requiredCitationTargets.length &&
      qualityFailures.length === 0 &&
      policyViolations.length === 0,
    policyViolations,
    qualityFailures,
  };
}

export function summarizeAdaptiveEvaluationMode(
  cases: AdaptiveEvaluationCase[],
  trials: AdaptiveEvaluationTrial[],
  mode: "baseline" | "candidate",
): AdaptiveEvaluationModeSummary {
  const modeTrials = trials.filter((trial) => trial.mode === mode);
  const questionResults = cases.map((entry) => {
    const matching = modeTrials.filter((trial) => trial.id === entry.id);
    const correctTrialCount = matching.filter((trial) => trial.correct).length;
    return {
      correct: correctTrialCount >= 2,
      correctTrialCount,
      domain: entry.domain,
      id: entry.id,
    };
  });
  const relevantCitations = modeTrials.reduce((sum, trial) => {
    const entry = cases.find((candidate) => candidate.id === trial.id);
    return sum + trial.citations.filter((citation) =>
      entry?.allowedCitationTargets.includes(citation.target)
    ).length;
  }, 0);
  const citationCount = modeTrials.reduce(
    (sum, trial) => sum + trial.citations.length,
    0,
  );
  const expectedCitationCount = modeTrials.reduce(
    (sum, trial) => sum + trial.expectedCitationTargets.length,
    0,
  );
  const foundExpectedCount = modeTrials.reduce(
    (sum, trial) => sum + trial.citationTargetsFound.length,
    0,
  );
  const eligibleTrials = modeTrials.filter(
    (trial) => trial.adaptiveRetry?.eligible,
  );
  const fallbackTrials = eligibleTrials.filter(
    (trial) => trial.adaptiveRetry?.fallbackUsed,
  );

  return {
    answerValidationPassRate: ratio(
      modeTrials.filter((trial) => trial.answerValidationStatus === "pass").length,
      modeTrials.length,
    ),
    citationPrecision: ratio(relevantCitations, citationCount),
    citationRecall: ratio(foundExpectedCount, expectedCitationCount),
    correctQuestionCount: questionResults.filter((result) => result.correct).length,
    correctTrialCount: modeTrials.filter((trial) => trial.correct).length,
    fallbackRate: ratio(fallbackTrials.length, eligibleTrials.length),
    inputTokens: sumUsage(modeTrials, "inputTokens"),
    latencyMs: {
      p50: percentile(modeTrials.map((trial) => trial.latencyMs), 0.5),
      p95: percentile(modeTrials.map((trial) => trial.latencyMs), 0.95),
    },
    mode,
    outputTokens: sumUsage(modeTrials, "outputTokens"),
    policyViolationCount: modeTrials.reduce(
      (sum, trial) => sum + trial.policyViolations.length,
      0,
    ),
    qualityFailureCount: modeTrials.reduce(
      (sum, trial) => sum + trial.qualityFailures.length,
      0,
    ),
    providerCallCount: modeTrials.filter((trial) =>
      trial.adaptiveRetry?.usage ||
      [
        "applied",
        "malformed_response",
        "provider_failed",
        "rejected_equivalent_query",
        "rejected_identifier_loss",
        "rejected_route_change",
        "rejected_scope_change",
      ].includes(trial.adaptiveRetry?.outcome ?? "")
    ).length,
    questionResults,
    totalTokens: sumUsage(modeTrials, "totalTokens"),
    totalTrials: modeTrials.length,
  };
}

export function compareAdaptiveEvaluationModes(input: {
  baseline: AdaptiveEvaluationModeSummary;
  candidate: AdaptiveEvaluationModeSummary;
  environmentValid: boolean;
  humanReviewPassed: boolean;
  routeSuitePassed: boolean;
}): AdaptiveEvaluationComparison {
  const baselineCorrect = new Set(
    input.baseline.questionResults
      .filter((result) => result.correct)
      .map((result) => result.id),
  );
  const candidateCorrect = new Set(
    input.candidate.questionResults
      .filter((result) => result.correct)
      .map((result) => result.id),
  );
  const regressionIds = [...baselineCorrect].filter(
    (id) => !candidateCorrect.has(id),
  );
  const questionGain =
    input.candidate.correctQuestionCount - input.baseline.correctQuestionCount;
  const gates = {
    citationPrecisionHeld:
      input.candidate.citationPrecision >= input.baseline.citationPrecision,
    humanReviewPassed: input.humanReviewPassed,
    minimumGainMet: questionGain >= ADAPTIVE_EVAL_REQUIRED_QUESTION_GAIN,
    noBaselineRegressions: regressionIds.length === 0,
    noPolicyViolations: input.candidate.policyViolationCount === 0,
    routeSuitePassed: input.routeSuitePassed,
  };
  const reasons = Object.entries(gates)
    .filter(([, passed]) => !passed)
    .map(([gate]) => gate);
  const passed = Object.values(gates).every(Boolean);
  return {
    baseline: input.baseline,
    candidate: input.candidate,
    decision: !input.environmentValid
      ? "invalid_environment"
      : passed
        ? "promote_to_internal_pilot"
        : "hold_for_tuning",
    gates,
    questionGain,
    regressionIds,
    reasons: !input.environmentValid ? ["invalid_environment", ...reasons] : reasons,
  };
}

function sameOrderedValues(left: string[], right: string[]) {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

function ratio(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : 0;
}

function percentile(values: number[], quantile: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * quantile) - 1),
  );
  return sorted[index] ?? 0;
}

function sumUsage(
  trials: AdaptiveEvaluationTrial[],
  key: keyof NonNullable<AdaptiveRetryTrace["usage"]>,
) {
  return trials.reduce(
    (sum, trial) => sum + (trial.adaptiveRetry?.usage?.[key] ?? 0),
    0,
  );
}

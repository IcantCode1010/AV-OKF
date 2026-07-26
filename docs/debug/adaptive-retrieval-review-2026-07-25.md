# 30-Question Adaptive Retrieval Evaluation

- Decision: `promote_to_internal_pilot`
- Baseline correctly cited: 15/30
- Candidate correctly cited: 23/30
- Question gain: 8
- Baseline citation precision: 100.0%
- Candidate citation precision: 100.0%
- Candidate provider calls: 86
- Candidate tokens: 35222
- Baseline latency p50/p95: 2129/2888 ms
- Candidate latency p50/p95: 3501/5078 ms
- Policy violations: 0
- Candidate quality failures: 8
- Human review: passed

## Gates

- citationPrecisionHeld: PASS
- humanReviewPassed: PASS
- minimumGainMet: PASS
- noBaselineRegressions: PASS
- noPolicyViolations: PASS
- routeSuitePassed: PASS

## Regressions

- None

## Retry Outcomes

- Applied: 33 trials
- No improvement: 27 trials
- Rejected route change: 26 trials
- Not eligible: 4 trials
- Validation failures: 0 trials

## Blinded Review

- Baseline complete responses: 15/30
- Candidate complete responses: 23/30
- New incorrect candidate responses: 0

All technical promotion gates pass. This result authorizes the scoped,
default-off internal pilot only; running-stack failure injection and the
five-reviewer non-technical trust study remain required before wider rollout.

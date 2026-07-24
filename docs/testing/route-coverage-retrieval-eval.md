# Route-Coverage Retrieval Evaluation

## Purpose

The route-coverage evaluation protects the full chat retrieval contract, not
only answer wording or general citation quality. It runs nine golden route scenarios
through the production chat service against Docker Postgres, Redis, the worker,
the live OKF bundle, pgvector, and the configured workspace LLM provider.

The evaluator asserts persisted assistant trace fields for:

- direct OKF lexical matching;
- OKF semantic fallback;
- typed-relation graph traversal;
- raw RAG discovery and reranking;
- Hybrid OKF-first evidence ordering;
- one-round missing-context clarification;
- a two-turn metadata clarification from approved OKF near misses, followed by
  raw-RAG discovery when the selected follow-up still has no qualified OKF;
- unsupported live-data refusal;
- clean RAG discovery fallback when the OKF semantic index is absent.
- deterministic evidence sufficiency and the reason raw RAG was or was not
  invoked;
- bounded adaptive-retry policy status when a bundle opts into the candidate.

The metadata scenario also proves that diagnostic near misses create no
citations and never enter answer validation. It checks every result for
retracted-content leakage and compares each
question's correct citation count with the committed baseline.

Stage 7C extends the same harness with thirteen release checks rather than a
parallel evaluator:

- authenticated PDF streaming for an owned document;
- indistinguishable cross-workspace and nonexistent-document responses;
- unauthenticated PDF rejection;
- retracted, archived, and deleted-source citation races;
- exact KnowledgeGap counts for true misses, resolved clarification, successful
  RAG discovery, and failed OKF-to-RAG fallback;
- an honest-miss response backed by persisted bundle/document search counts and
  containing no citation markers.

Any PDF authorization failure fails the whole run. Transport-generated HTTP
headers (`date`, connection management, and transfer encoding) are excluded
when comparing cross-workspace and nonexistent responses; every application
header, status, and response body must otherwise be identical.

## Run Locally

Start the production Docker stack and make sure Settings contains a usable LLM
provider key for at least one workspace. The worker must also have
`OPENAI_API_KEY` for RAG and OKF embeddings.

```powershell
docker compose up -d --build --wait
docker cp docs/debug/route-coverage-retrieval-baseline-2026-07-19.json av-okf-worker-1:/tmp/route-baseline.json
docker compose exec -T `
  -e EVAL_APP_BASE_URL=http://web:3000 `
  -e EVAL_BASELINE_PATH=/tmp/route-baseline.json `
  -e EVAL_OUTPUT_PATH=/tmp/route-report.json `
  worker node node_modules/tsx/dist/cli.mjs scripts/eval-retrieval-quality.mts routes local
```

To seed an otherwise empty CI workspace, also pass
`EVAL_LLM_API_KEY`. The harness stores it through the same encrypted workspace
settings function used by the product. The seed is idempotent and uses the
`Route Coverage Evaluation` bundle.

The Docker worker authenticates through the deployed credentials provider for
the HTTP checks. Its configured test-auth user must have the evaluation
workspace as its first workspace membership; the harness fails explicitly
rather than altering an existing user's workspace selection.

The GitHub Actions `route-coverage-eval` workflow exposes the same profile as a
manual CI job. It requires the repository secret `OPENAI_API_KEY`.

The first complete Stage 7C run is recorded in
[`docs/debug/stage-7c-route-coverage-report-2026-07-20.json`](../debug/stage-7c-route-coverage-report-2026-07-20.json).
It is a post-change report; the existing route baseline remains the citation
regression authority and was not rewritten simply to make this slice pass.

The first rollout-safety run after adding deterministic evidence sufficiency,
bundle-deletion tombstoning, and the default-off adaptive retry is recorded in
[`docs/debug/agent-rollout-route-coverage-2026-07-24.json`](../debug/agent-rollout-route-coverage-2026-07-24.json).
It passed all 9 golden questions, 12 Stage 7C release probes, and 3 Stage 7D
multi-bundle probes. The Stage 7D probes add a second bundle during a
conversation, prove a cross-bundle exact-value conflict is surfaced, remove
that bundle and prove it cannot appear in the later turn, and reject a
cross-workspace scope update. Because the seed bundles keep adaptive retry
disabled, this report proves deterministic non-regression and trace behavior;
it is not the required 30-question adaptive-retry promotion comparison.

## Add A Golden Question

When a router path or evidence mode is introduced:

1. Add or extend a deterministic fixture in `route-coverage-eval.mts`.
2. Add a case to `buildRouteCases()` with an explicit route, trace, negative,
   and expected-citation assertion.
3. Keep answer assertions structural. Do not compare exact LLM prose.
4. Run the profile twice: once to establish the expected result, then again
   against that saved report to prove repeatability.
5. Replace the committed baseline only after reviewing the route and citation
   change. Never update it merely to make a regression pass.

The question matrix must grow whenever the router gains a new route, retrieval
tool, or evidence mode. Otherwise a plausible answer can hide a path shift.

## Adaptive Retry Promotion Matrix

The disabled-by-default retry is not promoted by unit tests alone. Extend this
same evaluator with at least 30 mixed-domain weak or partial questions and save
both deterministic and candidate reports under `docs/debug/`.

Promotion requires:

- at least a 10-percentage-point improvement in correctly cited answers;
- no regression on any question the deterministic baseline answered correctly;
- no route changes, invented citations, unselected-bundle evidence, trust
  upgrades, or validation bypasses;
- recorded hit rate, citation precision, answer correctness, fallback rate,
  provider calls, token cost, and p50/p95 latency.

Running-stack release probes must also cover provider outage, malformed output,
budget exhaustion in existing query-understanding/rerank paths, partial
retrieval failure, mid-turn scope mutation, cross-bundle conflicts, deletion,
and cross-workspace isolation. Synthetic unit failures remain useful, but do
not satisfy this rollout gate.

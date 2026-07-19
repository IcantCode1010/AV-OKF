# Route-Coverage Retrieval Evaluation

## Purpose

The route-coverage evaluation protects the full chat retrieval contract, not
only answer wording or general citation quality. It runs eight golden questions
through the production chat service against Docker Postgres, Redis, the worker,
the live OKF bundle, pgvector, and the configured workspace LLM provider.

The evaluator asserts persisted assistant trace fields for:

- direct OKF lexical matching;
- OKF semantic fallback;
- typed-relation graph traversal;
- raw RAG discovery and reranking;
- Hybrid OKF-first evidence ordering;
- one-round missing-context clarification;
- unsupported live-data refusal;
- clean RAG discovery fallback when the OKF semantic index is absent.

It also checks every result for retracted-content leakage and compares each
question's correct citation count with the committed baseline.

## Run Locally

Start the production Docker stack and make sure Settings contains a usable LLM
provider key for at least one workspace. The worker must also have
`OPENAI_API_KEY` for RAG and OKF embeddings.

```powershell
docker compose up -d --build --wait
docker cp docs/debug/route-coverage-retrieval-baseline-2026-07-19.json av-okf-worker-1:/tmp/route-baseline.json
docker compose exec -T `
  -e EVAL_BASELINE_PATH=/tmp/route-baseline.json `
  -e EVAL_OUTPUT_PATH=/tmp/route-report.json `
  worker node node_modules/tsx/dist/cli.mjs scripts/eval-retrieval-quality.mts routes local
```

To seed an otherwise empty CI workspace, also pass
`EVAL_LLM_API_KEY`. The harness stores it through the same encrypted workspace
settings function used by the product. The seed is idempotent and uses the
`Route Coverage Evaluation` bundle.

The GitHub Actions `route-coverage-eval` workflow exposes the same profile as a
manual CI job. It requires the repository secret `OPENAI_API_KEY`.

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

# Route-Coverage Retrieval Evaluation Review

## Review Summary

AV-OKF now has an end-to-end route-coverage evaluation that verifies the chat
system uses the correct retrieval path, not merely that it produces a
plausible answer.

The evaluation was run twice against the real Docker stack. Both runs passed
all eight route scenarios.

| Result | Value |
| --- | --- |
| Route scenarios | 8 passed, 0 failed |
| Repeatability run | 8 passed, 0 failed |
| Full Node test suite | 358 passed, 1 skipped, 0 failed |
| ESLint | Passed |
| Production Next.js build | Passed |
| Base OKF validation | Passed |
| Base relation lint | Passed |
| Live multi-bundle vault validation | Passed |
| Seeded bundle relation lint | Passed |
| Docker services | Web, worker, Postgres, Redis, and MinIO healthy |

Implementation commit:
`1224c10f5d1be2cdc9de4225a2c408433fdfb6c9`
(`test: add route coverage retrieval evaluation`).

## What Was Added

The existing retrieval-quality evaluator was extended rather than creating a
second testing system.

The route profile now:

1. Creates or reuses a dedicated `Route Coverage Evaluation` knowledge bundle.
2. Seeds three approved OKF concepts, including one typed `routes_to` relation.
3. Seeds one retracted concept as a negative control.
4. Seeds and indexes one raw RAG document with no approved OKF coverage.
5. Waits for real OKF semantic embeddings to be completed by the worker.
6. Sends eight questions through the production chat service.
7. Reloads each persisted assistant message, trace, and citation from Postgres.
8. Checks the route, retrieval mode, graph use, reranker status, query rewrite
   mode, evidence type, and expected citations.
9. Fails if retracted content leaks into any answer.
10. Compares citation correctness with the committed baseline report.

The evaluation uses real Postgres, Redis, MinIO, BullMQ worker processing,
pgvector, the live OKF bundle, and the configured LLM/embedding provider. It
does not use mocked retrieval results.

## Scenarios And Results

| Scenario | Expected behavior | Recorded result |
| --- | --- | --- |
| Direct OKF lexical match | Route to `okf_only`; use lexical OKF matching; cite the approved concept; do not rerank | Passed |
| OKF semantic fallback | Route to `okf_only`; use vector matching when wording has no qualifying lexical match; cite the same approved concept | Passed |
| OKF graph traversal | Traverse a typed relation; return both the seed and related approved concepts; do not rerank | Passed |
| Raw RAG discovery | Route to `rag_only`; avoid OKF retrieval; return unreviewed raw evidence; apply reranking | Passed |
| Hybrid retrieval | Return approved OKF first and raw RAG as support; rerank only the raw candidates | Passed |
| Missing context | Return one clarification request; perform no retrieval; create no citations | Passed |
| Unsupported live-data request | Return the unsupported/refusal path; perform no retrieval; create no citations | Passed |
| Missing OKF vector fallback | Remove the relevant OKF embedding rows; degrade to labeled raw RAG discovery without crashing | Passed |

Important persisted trace results included:

- lexical OKF: `route=okf_only`, `okfMatchMode=lexical`;
- semantic OKF: `route=okf_only`, `okfMatchMode=vector`;
- graph: `requiresGraphTraversal=true`, `okfEvidenceMode=graph`;
- raw RAG: `route=rag_only`, `ragUsedForDiscoveryOnly=true`, reranker applied;
- hybrid: `route=hybrid`, OKF and RAG retrieval tools both recorded;
- missing context: `route=missing_context`, no citations;
- unsupported: `route=unsupported`, no citations;
- unavailable OKF vector: raw discovery fallback completed without an error.

Every scenario also verified that the seeded retracted concept was absent from
the evidence.

## Files For App Review

Start with these files:

1. **Reviewer instructions and maintenance guidance**
   [`docs/testing/route-coverage-retrieval-eval.md`](./route-coverage-retrieval-eval.md)

2. **Committed machine-readable baseline and all eight recorded traces**
   [`docs/debug/route-coverage-retrieval-baseline-2026-07-19.json`](../debug/route-coverage-retrieval-baseline-2026-07-19.json)

3. **End-to-end seed, execution, assertions, and report generation**
   [`apps/web/scripts/route-coverage-eval.mts`](../../apps/web/scripts/route-coverage-eval.mts)

4. **Existing evaluator entry point extended with route mode**
   [`apps/web/scripts/eval-retrieval-quality.mts`](../../apps/web/scripts/eval-retrieval-quality.mts)

5. **Manual GitHub Actions workflow**
   [`.github/workflows/route-coverage-eval.yml`](../../.github/workflows/route-coverage-eval.yml)

6. **Persisted trace instrumentation**
   [`apps/web/src/lib/production-chat-service.ts`](../../apps/web/src/lib/production-chat-service.ts)
   [`apps/web/src/lib/chat-router.ts`](../../apps/web/src/lib/chat-router.ts)

7. **Trace regression test**
   [`apps/web/src/lib/production-chat-service.test.mts`](../../apps/web/src/lib/production-chat-service.test.mts)

The complete implementation diff is commit `1224c10`.

## How To Reproduce

Start the real production-style Docker stack:

```powershell
docker compose up -d --build --wait
```

Copy the committed baseline into the worker and run the route profile:

```powershell
docker cp docs/debug/route-coverage-retrieval-baseline-2026-07-19.json av-okf-worker-1:/tmp/route-baseline.json

docker compose exec -T `
  -e EVAL_BASELINE_PATH=/tmp/route-baseline.json `
  -e EVAL_OUTPUT_PATH=/tmp/route-report.json `
  worker node node_modules/tsx/dist/cli.mjs scripts/eval-retrieval-quality.mts routes review

docker cp av-okf-worker-1:/tmp/route-report.json route-coverage-report.json
```

At least one workspace must have a valid provider key configured. The worker
must have `OPENAI_API_KEY` for raw-RAG and OKF embeddings. For an empty test
workspace, pass `EVAL_LLM_API_KEY` to seed the provider setting through the
same encrypted settings path used by the application.

The package command is:

```powershell
pnpm --dir apps/web test:e2e:routes
```

The GitHub workflow is intentionally manual (`workflow_dispatch`) and requires
the repository secret `OPENAI_API_KEY`. The successful results summarized in
this document came from two real local Docker runs; this report does not claim
a hosted GitHub Actions run occurred.

## Reviewer Acceptance Checklist

- Confirm the eight scenarios represent every current router path and evidence
  mode.
- Inspect the baseline JSON and verify each expected concept/file citation.
- Confirm RAG reranking is absent from OKF-only and non-retrieval paths.
- Confirm clear questions use `queryUnderstanding.rewriteMode=not_needed`.
- Confirm retracted content never appears.
- Run the profile against the committed baseline and confirm 8/8 pass.
- Review any future baseline update as a behavior change; do not replace the
  baseline only to make a regression pass.

## Scope And Limitations

This work added evaluation coverage and the minimum trace fields needed to
observe existing behavior. It did not change routing, retrieval, answer
generation, evidence trust rules, or UI behavior.

The profile does not yet inject provider outages, budget exhaustion, service
restarts during a chat turn, latency thresholds, or cross-bundle isolation
attacks. Those remain separate future evaluation slices.

# Stage 6 Chat/RAG Test Plan And Results - 2026-07-05

## Scope

Verify the current Stage 6 chat pipeline from the running Docker stack:

1. Product shell and chat session access.
2. Router behavior for missing-context, unsupported, OKF, RAG, and hybrid questions.
3. Retrieval-backed answers with visible sources and trace details.
4. Backend/browser error signals.
5. Regression commands for app tests, lint, production build, and OKF validators.

This test pass does not modify application code.

## Environment

- Runtime: Docker Compose production data plane.
- Services observed healthy: `web`, `worker`, `postgres`, `redis`, `minio`, `caddy`.
- Health endpoint: `http://localhost:3000/api/health` returned `{"ok":true,"service":"av-okf-web"}`.
- Browser target: `http://localhost:3000/chat`.
- Test session created: `http://localhost:3000/chat/cmr8keloh000301qxvxbz3ggc`.

## Test Matrix

| ID | Area | Question / Action | Expected Result | Result |
| --- | --- | --- | --- | --- |
| T1 | Chat access | Open `/chat`, create a new chat | Chat session opens and composer is available | Pass |
| T2 | Missing context route | `Can we dispatch?` | Refuses to route without aircraft/effectivity/source/operational context; no sources | Pass |
| T3 | Unsupported route | `What is the current weather in Dallas right now?` | Explains static uploaded documents cannot answer live data; no sources | Pass |
| T4 | OKF-first route with RAG support | `What does the knowledge base say about landing gear?` | Answer appears, sources are listed, trace shows OKF route with OKF/RAG retrieval tools | Pass |
| T5 | Hybrid route | `Give me the approved answer and supporting manual examples for landing gear.` | Answer appears, sources are listed, trace shows Hybrid route and OKF/RAG tools | Pass |
| T6 | RAG route | `Find every place the documents mention air-ground logic.` | Answer appears, sources are listed, trace shows RAG route | Pass |
| T7 | Browser console | Read warning/error logs after chat tests | No browser console warnings/errors | Pass |
| T8 | Backend logs | Read recent `web` and `worker` logs | No request/runtime errors from chat tests | Pass |
| T9 | Automated regression | Run full web test suite | All tests pass | Pass |
| T10 | Lint | Run ESLint | No lint errors | Pass |
| T11 | Production build | Run Next production build with test auth disabled | Build passes | Pass with existing Turbopack NFT warnings |
| T12 | OKF relation lint | Run custom relation linter | Pass with zero violations | Pass |
| T13 | OKF base validation | Run okflint validation | Pass | Pass via Python module with UTF-8 output |

## Browser Results

### T2 Missing Context

Observed response:

> I need a little more context before routing this safely. Please provide: aircraft family, effectivity, source authority, operational context.

Visible trace:

- Category: `Missing context`
- Confidence: `high confidence`
- Tools called: `None for this route`
- Sources: `No sources for this reply`

### T3 Unsupported

Observed response:

> I cannot answer that from static uploaded documents alone. This question needs live data or an external system that is not connected yet.

Visible trace:

- Category: `Unsupported`
- Confidence: `high confidence`
- Rationale: live/external data cannot be supplied by static uploaded documents
- Tools called: `None for this route`

### T4 OKF-First

Observed response answered the landing gear question and listed six sources. The visible trace showed:

- Route: `Routed to OKF`
- Confidence: `medium confidence`
- Answer mode: `LLM answer - gpt-4o-mini`
- Tools called: `okf_retrieval`, `rag_retrieval`
- Sources read included `737 air-ground` and `737 qrh` page ranges.

### T5 Hybrid

Observed response answered the approved-answer-plus-examples question and listed six sources. The visible trace showed:

- Route: `Routed to Hybrid`
- Confidence: `medium confidence`
- Answer mode: `LLM answer - gpt-4o-mini`
- Tools called: `okf_retrieval`, `rag_retrieval`
- Sources read included `737 qrh` page ranges.

### T6 RAG

Observed response answered the broad air-ground logic search and listed six sources. The visible trace showed:

- Route: `Routed to RAG`
- Confidence: `high confidence`
- Answer mode: `LLM answer - gpt-4o-mini`
- Tools called: `rag_retrieval`
- Sources read included `737 air-ground` page ranges and one `engine exhaust` hit.

## Backend And Console Logs

Browser console:

- No `warn` or `error` entries after the browser smoke tests.

Web container logs:

- No chat runtime errors observed.
- Existing startup warning observed: `test_auth_enabled_in_production: local test credentials are enabled with a non-default password`.

Worker container logs:

- No recent worker errors observed.

## Command Results

```text
docker compose ps
```

Result: all six services were up; `postgres`, `minio`, and `web` were healthy.

```text
curl.exe -s http://localhost:3000/api/health
```

Result:

```json
{"ok":true,"service":"av-okf-web"}
```

```text
pnpm --dir apps/web test
```

Result:

```text
tests 239
pass 239
fail 0
duration_ms 4458.2181
```

```text
pnpm --dir apps/web lint
```

Result: pass.

```text
$env:AV_OKF_TEST_AUTH_ENABLED='false'; pnpm --dir apps/web build
```

Result: pass. Existing Turbopack NFT warnings remain around `okf-relations.ts` importing manifest-related code into the document detail route.

```text
python tools/okf_relation_lint.py --manifest okf-base.yaml
```

Result:

```json
{
  "status": "pass",
  "violation_count": 0,
  "violations": []
}
```

```text
$env:PYTHONIOENCODING='utf-8'; python -m okflint validate --manifest okf-base.yaml
```

Result:

```text
✅ All files are OKF-conformant.
```

## Notes

- The first chat send required polling for completion because the immediate state briefly showed `Sending...`; it completed normally and was not stuck.
- The `okflint` executable is not on this shell's PATH. Running `python -m okflint` works.
- Running `python -m okflint` without `PYTHONIOENCODING=utf-8` on this Windows shell validates successfully but fails while printing the success checkmark due to CP1252 console encoding. The UTF-8 rerun passed cleanly.
- The answer text uses numeric citation markers as plain numbers in the visible UI, while the Sources panel provides the source mapping. This is functional, but a future UI polish pass should make citation markers visually unambiguous.

## Verdict

Stage 6 chat/RAG behavior passed this focused verification:

- Router categories work for representative cases.
- Retrieval-backed answers return sources and trace details.
- LLM answer generation is active for source-backed routes.
- No browser or backend runtime errors were observed.
- Regression tests, lint, build, relation lint, and OKF validation passed.

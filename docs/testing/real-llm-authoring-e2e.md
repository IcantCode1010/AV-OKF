# Real LLM Authoring End-to-End Profile

This profile verifies the real document lifecycle with the active LLM provider and encrypted API key saved in **Settings -> AI Enrichment**. It never accepts a separate provider key and never permits a deterministic LLM fallback.

## Browser workflow

1. Create or select a disposable knowledge bundle.
2. Upload a real PDF and record its document ID.
3. Observe `queued -> running -> completed` extraction without manually refreshing.
4. Open **AI authoring** and start guided authoring.
5. Observe metadata discovery, concept discovery, enrichment, relation classification, and validation.
6. Confirm the run stops at `ready_for_review`.
7. Review each topic's title, summary, source pages, raw content, and enriched content.
8. Explicitly approve one content version and export it to OKF.
9. Run both OKF validators.
10. Ask a chat question covered by the exported concept and confirm an Approved OKF evidence card cites it.

## Real-provider command

Run this inside the production web container so it uses the same database, encryption key, and provider configuration as the app:

```bash
docker compose exec \
  -e E2E_DOCUMENT_ID=<document-id> \
  -e E2E_CONFIRM_COST=true \
  web ./node_modules/.bin/tsx scripts/e2e-llm-authoring.mts
```

For a multi-concept relation fixture, also set `E2E_REQUIRE_RELATIONS=true`. The command fails unless at least one LLM-classified relation suggestion is produced.

The report includes document ID, authoring run ID, provider/model audit records, attempt numbers, generated topics, source pages, enrichment status, and relation suggestion count. It never includes the decrypted API key.

## Relation fixture requirements

Use a real document with at least three related concepts whose titles and summaries share meaningful subject terms or adjacent page coverage. Candidate generation remains deterministic. The configured LLM only classifies candidate pairs; it cannot invent new pairs. Pending suggestions must not enter frontmatter, the graph, or agent traversal until a reviewer approves and exports them.

## Required result checks

- No stage uses a mock or deterministic LLM provider.
- Failure is attributed to the exact active stage and attempt.
- Retry resumes at the failed stage.
- Human approval and export remain manual.
- Pending or rejected relations remain invisible to agent graph traversal.
- Approved exported relations pass `okf_relation_lint.py` and appear as graph edges/backlinks.

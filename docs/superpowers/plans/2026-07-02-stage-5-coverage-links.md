# Stage 5 OKF-to-RAG Coverage Links Implementation Plan

> Scoping document, not yet implemented. This exists because the roadmap already lists coverage links as a completed-looking Stage 5 deliverable, but no code populates or reads them. Read this before starting implementation; it records the gap, the reusable pieces already in place, and the open decisions that need an answer before work starts.

**Goal:** Let an approved OKF concept declare which RAG chunks and source pages it governs, and let RAG retrieval report when a result is already covered by an approved OKF concept, per `docs/architecture/ingestion-to-knowledge-flow.md`.

**Current state (verified 2026-07-02):**

- `okf-base.yaml` already lists `covered_rag_chunk_ids`, `covered_topic_record_ids`, and `coverage_type` as optional frontmatter fields on every OKF type.
- `okf-export.ts` / `okf-export-service.ts` never write those fields. Only `relations` is populated at export time.
- `apps/web/prisma/schema.prisma` already has an `OkfConceptChunkLink` model (`workspaceId`, `okfConceptId`, `chunkId`, `coverageType`, `source`, `syncedAt`), added by the Stage 4 migration `20260701110000_stage_4_rag_search`, with the Stage 4 plan's own note: "OKF coverage source of truth: approved OKF Markdown frontmatter... DB coverage table: derived query projection only." Nothing writes or reads this table.
- `RetrievalResult.coveredByOkfConceptIds` (`rag-types.ts`) is a real typed field, but `rag-repository.ts` hardcodes it to `[]` in both `searchKeyword` and `searchVector`.

So the schema and the retrieval contract both already assume this feature exists; only the population and read paths are missing.

## Scope

In scope:

- Populating `covered_rag_chunk_ids` / `coverage_type` in exported OKF frontmatter
- Syncing that frontmatter into `OkfConceptChunkLink` as a derived projection
- Wiring `rag-repository.ts` to return real `coveredByOkfConceptIds` values
- Tests for the resolver, the sync, and the retrieval wiring

Out of scope (do not bundle into this work):

- Stage 6 router / Stage 7 validator consumption of coverage (they only need `coveredByOkfConceptIds` to exist and be correct; how they use it is a later stage's concern)
- A reviewer-facing UI for hand-picking which chunks a topic covers (see Open Decision 1 below — default to automatic page-overlap first)
- `covered_topic_record_ids` (Stage 3 topic-to-topic linkage) — separate from RAG chunk coverage, do not conflate

## Open Decisions (resolve before writing code)

1. **How is coverage determined at export time?** The topic record already carries `sourcePageNumbers` for the document it came from. The cheapest correct default: at export, look up all *active* RAG chunks (`RagChunk.isActive = true`) for the same `documentId` whose `sourcePageNumbers` overlap the topic's `sourcePageNumbers`, and mark them `coverage_type: direct_source`. This requires no new reviewer UI and matches "approved OKF links back to the RAG chunks it covers" from the architecture doc. Confirm this is the intended v1 behavior before building a manual-selection UI instead.
2. **Local JSON-vault backend has no RAG chunks.** Stage 4 RAG only exists in the Postgres/pgvector production backend (`rag-repository.ts`). The local dev/test export path (`okf-export.ts` used directly, no Postgres) has nothing to query. Decide whether local exports simply skip coverage population (leave `covered_rag_chunk_ids` empty) — this seems right, since local/JSON is documented everywhere else as a dev fixture, not a production path.
3. **Sync trigger.** Sync `OkfConceptChunkLink` from frontmatter either (a) inline during `exportTopicToKnowledge`, right after the coverage fields are computed, or (b) as a separate idempotent reconciliation job that re-reads all approved OKF files and re-syncs the table. (a) is simpler and keeps single-writer semantics; (b) is more robust to manual bundle edits. Recommend (a) for v1 since okflint already gates manual frontmatter edits in CI.

## Files

Create:

- `apps/web/src/lib/okf-coverage.ts` — resolves overlapping active RAG chunks for a topic's page range, and syncs `OkfConceptChunkLink` rows for one exported topic
- `apps/web/src/lib/okf-coverage.test.mts`

Modify:

- `apps/web/src/lib/okf-export.ts` — accept resolved `coveredRagChunkIds`/`coverageType` in `ExportTopic`/`BuildOkfSystemTopicInput`, write them into frontmatter when non-empty (mirror the existing `relations` conditional-write pattern at line ~100)
- `apps/web/src/lib/okf-export-service.ts` — when running against the production backend, call the new resolver before `exportTopicToKnowledge` and pass the result through; skip resolution entirely on the local JSON backend (Open Decision 2)
- `apps/web/src/lib/rag-repository.ts` — in `searchKeyword` and `searchVector`, join `OkfConceptChunkLink` on `chunkId` and populate `coveredByOkfConceptIds` instead of `[]`
- `apps/web/src/lib/okf-export.test.mts`, `apps/web/src/lib/okf-export-service.test.mts`, `apps/web/src/lib/rag-repository.test.mts` — extend existing suites, do not replace them

## Task Breakdown

1. **Resolver:** `resolveOkfCoverage({ workspaceId, documentId, sourcePageNumbers })` in `okf-coverage.ts` queries active `RagChunk` rows for the document, returns chunk ids whose `sourcePageNumbers` intersect the topic's range, tagged `coverage_type: "direct_source"`. Unit test with a fake repository (same fake-client pattern as `rag-repository.test.mts`).
2. **Frontmatter write:** extend `buildOkfSystemTopic` to emit `covered_rag_chunk_ids` (array) and `coverage_type` (scalar) only when the resolved list is non-empty, same conditional-write style already used for `relations`. Extend the filename/id hashing path not at all — coverage fields don't affect the filename.
3. **Sync:** `syncOkfConceptCoverage({ okfConceptId, chunkIds, coverageType, workspaceId })` in `okf-coverage.ts` upserts `OkfConceptChunkLink` rows and deletes stale ones for that `okfConceptId` no longer in the resolved set (re-export must not leave orphaned links). Call it from `okf-export-service.ts` right after `exportTopicToKnowledge` succeeds, production backend only.
4. **Retrieval read path:** in `rag-repository.ts`, batch-fetch `OkfConceptChunkLink` rows for the chunk ids in a result page and group by `chunkId` to fill `coveredByOkfConceptIds`. Keep this a single extra query per search call, not N+1 per result.
5. **Tests:** resolver unit tests, export-with-coverage integration test (frontmatter contains the fields), sync upsert/delete test, retrieval test asserting a chunk covered by an approved concept reports its id and an uncovered chunk reports `[]`.
6. **Docs:** update `docs/architecture/ingestion-to-knowledge-flow.md` coverage-link section only if the implementation deviates from Open Decision 1's default; otherwise no doc change needed since the architecture doc already describes this design correctly — it was the code that lagged, not the doc.

## Definition Of Done

- An approved topic exported against the production backend has non-empty `covered_rag_chunk_ids` in its frontmatter when overlapping indexed chunks exist.
- `OkfConceptChunkLink` rows exist for that topic and are removed/updated on re-export if coverage changes.
- `searchKeyword`/`searchVector` results for a covered chunk return the real `coveredByOkfConceptIds`, not `[]`.
- Roadmap Stage 5 exit criterion "Approved OKF concepts can identify the RAG chunks and source pages they govern" is demonstrably true, not just schema-possible.

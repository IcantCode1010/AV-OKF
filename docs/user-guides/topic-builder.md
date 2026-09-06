# Topic-driven knowledge bundles

Open **Topic builder** in the workspace sidebar (`/topic-builder`).

1. Upload and finish extracting documents in one or more source collections.
2. Enter a topic, aircraft applicability, audience and article word limit (default 180).
3. Select the source collections and choose **Create and generate**.
4. Review concise answers, expandable detail, exact source quotations and conflicts.
5. Approve the revision and download its native OKF ZIP.
6. Add or update source documents, then choose **Refresh from documents** on the same recipe.

A changed collection is rescanned in full so new documents can change the relevance of existing material. Original extraction is reused. Checkpointed source analysis is reused only when retrying the same corpus. An unchanged collection returns the existing ready/approved revision without another model call.

The recipe keeps its identity. The model is instructed to retain continuing article IDs; additions, updates and removals are reported for review. Previous approved snapshots are not overwritten. Approval changes the recipe's current approved-revision pointer in a database transaction.

## Boundaries

- Uses the workspace's existing encrypted AI-provider configuration, never a client key.
- Collections must belong to the signed-in workspace. Deleted documents are excluded.
- Incomplete extraction, unreadable source pages, invalid quotations, missing evidence and changed source snapshots block completion/export.
- Every selected text section is checked. This workflow does not interpret figure-only pages or generate illustrations; existing media authoring remains separate.
- The 80–500-word limit covers the answer, key points and optional details together. Up to four correction passes repair invalid/overlong drafts using the prior draft, measured word counts, and valid article relationship targets.
- One active run per recipe, one builder worker at a time. Progress persists; cancellation prevents a result from being committed after a provider call returns.
- A synthesis is bounded to 15 articles and 220,000 characters of evidence. If exceeded, it stops explicitly; it does not report an exhaustive result or silently truncate.
- Conflicts remain visible and require explicit acknowledgment at approval. Publication approval does not establish manufacturer authority.
- The ZIP contains native OKF Markdown, source passages, an index and a derived graph. It is not a signed EFB production release and does not automatically activate content in EFB. Existing EFB export/activation remains a separate boundary.

## Verification

`node --experimental-strip-types --test src/lib/topic-builder-core.test.mts` covers schema, coverage, source references, word limits, graph integrity and native export.

`docker compose exec -T web node node_modules/tsx/dist/cli.mjs scripts/verify-topic-builder.mts` runs a live AI test using temporary training-excerpt documents: two-document generation, approval, unchanged-corpus reuse, a third-document refresh, prior-revision preservation and source removal. It removes its temporary database records. This consumes normal provider usage.

`node apps/web/scripts/verify-topic-builder-browser.mjs` verifies local Docker sign-in and responsive UI using the configured test credentials without logging them. The development verification script uses the Playwright installation in the neighboring EFB project; it is not required by the app runtime.

## Verified locally — 2026-09-05

- Docker Desktop recovered by moving stale runtime socket directories aside; database/object-storage volumes were preserved.
- Caddy, web, worker, PostgreSQL, Redis and MinIO running; migration/initialization jobs exited successfully. All 47 migrations applied.
- Docker production build and its TypeScript check passed. A binary-checksum overload error in the existing EFB exporter was corrected; its 13 regression tests passed.
- Six topic-builder contract tests passed. Live provider generation from two source excerpts, approval, a third-source refresh, unchanged-corpus reuse and previous-revision preservation passed; temporary test records removed.
- Native ZIP integrity verified with Python's ZIP reader.
- Real browser sign-in, desktop/tablet/phone layout, visible invalid-form feedback and anonymous export denial passed.
- The repository-wide standalone TypeScript invocation still reports unrelated pre-existing test-fixture typing errors. The production build is green; those broader test types were not rewritten.

### Choose documents already in your library

The default **Select documents** source mode lists existing workspace documents by title and collection. Search, select one or more ready documents, then enter your topic and generate. Selections remain selected when filtering the list. Sources needing extraction are labeled and link to their document page.

A document recipe refreshes only its selected documents. Choose **Entire collections** when future uploads should be included automatically on refresh. Existing collection recipes retain that behavior. Deleted or unavailable selected documents block generation/export rather than silently dropping evidence.

Evidence extraction uses numbered, contiguous source passages. The model selects passage ranges; the server copies the original text, preserving punctuation, OCR spelling and whitespace. Out-of-range selections are rejected and retried up to three times. Previously validated sections are reused on retry. This verifies quotation provenance, not the factual interpretation of every generated claim; editorial review remains necessary.


### Instructor voice and rewrites

Articles lead with a supported technical explanation, then develop useful relationships and conditions in plain language. Source limitations appear briefly where needed; the prose does not narrate the compilation task. Evidence IDs remain in structured references.

Use **Rewrite articles** to create a new draft with the current writing policy, even when documents have not changed. Validated extraction checkpoints are reused for unchanged sources. Earlier drafts and approved revisions remain intact; a rewrite does not approve or publish itself.

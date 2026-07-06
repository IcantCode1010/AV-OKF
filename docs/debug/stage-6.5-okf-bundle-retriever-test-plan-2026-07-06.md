# Stage 6.5 Agent-Ready OKF Bundle Retriever - Test Plan

## Scope

Stage 6.5 replaces the `okf_topic` RAG-embedded projection as the OKF retrieval
path for chat. `retrieveOkfBundleEvidence` (`okf-bundle-retriever.ts`) now reads
the exported `knowledge/` bundle directly - parsing frontmatter
(`okf-frontmatter.ts`), filtering to `review_status: approved`, scoring by
term match, and returning evidence `chat-retrieval.ts` turns into citations.
The RAG `okf_topic` sync becomes an optional legacy cache
(`admin/reindex/page.tsx`), no longer read by the `okf_only`/hybrid routes.

This plan covers unit coverage for the new/changed modules, integration
coverage for the retrieval seam, and a manual pass through the running app.
It does not cover Stage 7 validation (claim-level checks) or Stage 8 aviation
rules.

## Areas And Risk

| Area | Files | Why it matters |
| --- | --- | --- |
| Frontmatter parsing | `okf-frontmatter.ts` | Every field the retriever and `okf-bundle.ts`/`okf-relations.ts` depend on flows through this parser; a regression here silently corrupts retrieval, the bundle browser, and relation lint. |
| Bundle retrieval | `okf-bundle-retriever.ts` | New source of truth for `okf_only`/hybrid chat answers. Must only surface approved topics, must not leak path-traversal, must degrade gracefully when `knowledge/` is missing/empty. |
| Chat retrieval wiring | `chat-retrieval.ts` | Must call the bundle retriever (not RAG `okf_topic`) for OKF evidence, preserve citation indexing/ordering across combined OKF+RAG hybrid results, and keep the RAG-discovery-fallback and error-degradation paths intact. |
| Citation shape/UI | `chat-types.ts`, `chat-evidence-card.tsx` | New `okfFilePath`/`sourceFile` fields must render without breaking existing RAG-only citations that lack them. |
| Legacy cache demotion | `admin/reindex/page.tsx` | Must read as optional/legacy, not as a required step for OKF answers to work. |
| Downstream reuse | `okf-bundle.ts`, `okf-relations.ts` | Both were refactored to share `okf-frontmatter.ts` - regression risk is silent frontmatter-shape drift breaking the bundle browser or relation lint. |

## Unit Test Matrix

### `okf-frontmatter.ts` (existing `okf-frontmatter.test.mts` - confirm coverage)

| ID | Case | Status |
| --- | --- | --- |
| U1 | Scalar fields (quoted and unquoted) parse correctly | Covered |
| U2 | `source_pages`-style number arrays parse as both string[] and number[] | Covered |
| U3 | `covered_rag_chunk_ids` string arrays parse | Covered |
| U4 | Typed `relations` blocks parse into `TopicRelation[]` | Covered |
| U5 | Body is returned separately from frontmatter, leading blank line stripped | Covered |
| U6 | **Gap**: no frontmatter block (plain markdown) returns `{ body: full text, frontmatter: {} }` | Add |
| U7 | **Gap**: malformed/unterminated `---` block does not throw, falls back sanely | Add |
| U8 | **Gap**: mixed scalar + list keys in one block parse independently (regression guard for the line-index-splicing logic in `parseOkfFrontmatterBlock`) | Add |
| U9 | **Gap**: relation item missing an optional property (e.g. no `reason`) defaults to `""` via `getFrontmatterRelations`, not `undefined` | Add |
| U10 | **Gap**: empty list key (`tags:` with no `- ` lines following) returns `[]`, not a parse error | Add |

### `okf-bundle-retriever.ts` (existing `okf-bundle-retriever.test.mts` - confirm coverage)

| ID | Case | Status |
| --- | --- | --- |
| U11 | Approved topic returns normalized evidence with correct excerpt/pages/title | Covered |
| U12 | Unapproved, missing-review-status, and reserved files (`index.md`) are excluded | Covered |
| U13 | Relations and coverage fields (`covered_rag_chunk_ids`, `coverage_type`) pass through | Covered |
| U14 | Missing bundle root returns `[]` instead of throwing | Covered |
| U15 | Ranking is deterministic and tie-breaks by title then file path | Covered |
| U16 | Retriever reflects live filesystem state (edits/status changes) between calls | Covered |
| U17 | **Gap**: topic missing a required field (`title`, `description`, `source_file`, or empty `source_pages`) is excluded even when `review_status: approved` | Add |
| U18 | **Gap**: empty query string / whitespace-only query returns `[]` without touching the filesystem | Add |
| U19 | **Gap**: `topK` truncates results and defaults to 4 when omitted | Add |
| U20 | **Gap**: nested subdirectories under `knowledge/` are traversed (`collectMarkdownFiles` recursion) | Add |
| U21 | **Gap**: a file path attempting to escape the resolved root (defense-in-depth on the `fullPath.startsWith` guard) is skipped, not thrown | Add |
| U22 | **Gap**: excerpt truncates at `EXCERPT_MAX_CHARS` (1500) with a trailing ellipsis, not mid-word overflow | Add |
| U23 | **Gap**: scoring - exact multi-word query match in title outranks scattered single-term matches in body only | Add |
| U24 | **Gap**: two approved topics with identical scores and identical titles fall back to `filePath` ordering (full tie-break chain) | Add |

### `chat-retrieval.ts` (existing `chat-retrieval.test.mts` - confirm coverage after refactor)

| ID | Case | Status |
| --- | --- | --- |
| U25 | `okf_only` calls `retrieveOkf`, not `retrieve` (RAG), and maps `okfFilePath`/`sourceFile` onto the citation | Covered |
| U26 | `okf_only` with zero bundle results downgrades to labeled RAG discovery, calling both tools in order `["okf_retrieval","rag_retrieval"]` | Covered |
| U27 | `okf_only` with approved evidence is never flagged `ragUsedForDiscoveryOnly` | Covered |
| U28 | Hybrid without approved OKF is flagged as discovery; hybrid with approved OKF is not | Covered |
| U29 | `resolveEvidenceStatus` maps all four outcomes correctly | Covered |
| U30 | `rag_only` never calls `retrieveOkf` | Covered |
| U31 | Hybrid combines OKF-then-RAG citations with contiguous indexes (OKF results indexed first) | Covered |
| U32 | `missing_context`/`unsupported` never call either retriever | Covered |
| U33 | A thrown error from `retrieveOkf` degrades to `retrievalError: true` (not a crash) - mirror the existing RAG-side error test | Covered |
| U34 | **Gap**: a thrown error from `retrieveOkf` specifically during hybrid (after RAG already resolved, or before) still degrades cleanly and doesn't return partial/inconsistent citation indexes | Add |
| U35 | **Gap**: `okf_retrieval` call always passes `topK: OKF_TOP_K` (4) regardless of route | Add |
| U36 | **Gap**: `buildRetrievalAnswer` / `introForRetrieval` copy still reads as non-authoritative when `ragUsedForDiscoveryOnly` is true for hybrid, not just `okf_only` | Add |

### `okf-bundle.ts` / `okf-relations.ts` (regression guard after sharing `okf-frontmatter.ts`)

| ID | Case | Status |
| --- | --- | --- |
| U37 | Existing `okf-export.test.mts` suite still passes unchanged after the `readScalar`/`readFrontmatterScalar` removal (shared parser produces identical `reviewStatus`/`title`/`type`/relation-target-type results) | Verify (run suite) |
| U38 | **Gap**: `validateTopicRelations` still throws `relation_target_type_mismatch` for a target whose frontmatter type doesn't match, using the shared parser's relation output | Add if not already covered |

## Integration / Manual Test Matrix (running app)

Executed 2026-07-06 against `next dev -p 3100` (`AV_OKF_BACKEND=production`) with
throwaway Docker Postgres/Redis, `AV_OKF_KNOWLEDGE_ROOT` pointed at the real
repo `knowledge/` directory (one approved topic:
`32-main-gear-brake-system-494f144a6e.md`, "Main Gear Brake System"), no
documents uploaded, no OpenAI key configured (see Notes for the implication).

| ID | Area | Action | Expected Result | Result |
| --- | --- | --- | --- | --- |
| I1 | OKF-only route | Ask a canonical question matching an approved topic in `knowledge/` | Answer cites the bundle file; trace shows `okf_retrieval` only; evidence card shows `OKF file: <path>` | Pass |
| I2 | OKF downgrade | Ask a canonical-shaped question with no matching approved topic | Answer explicitly reads as unreviewed/discovery, not official | See Notes - not reproducible as designed with this dataset (scoring gap found) |
| I3 | Hybrid | Ask a question needing both approved concept and raw examples | Citations list OKF results first, then RAG; trace shows `approvedOkfAvailable: true` | Pass |
| I4 | RAG-only | Ask an open-ended/search question | `retrieveOkf` is never invoked (trace tool list = `rag_retrieval` only) | Pass |
| I5 | Bundle edit reflected live | Flip `review_status` on the approved topic file, re-ask without restarting the app, then revert | Result set changes immediately, no caching staleness; reverts cleanly | Pass |
| I6 | Legacy reindex page | Open `/admin/reindex` | Copy reads as "legacy/optional cache", not required for chat to answer from OKF | Pass |
| I7 | Citation UI regression | Expand the "1 sources" detail sheet on an OKF-routed answer | Evidence card renders `Source: <sourceFile> \| OKF file: <path>` cleanly | Pass |
| I8 | Empty/missing bundle | Rename `knowledge/` away, ask an OKF-shaped question, then restore | No crash; downgrades to RAG discovery fallback, "no evidence" (0 chunks indexed) | Pass |

## Regression Commands

```bash
pnpm --dir apps/web test
pnpm --dir apps/web lint
pnpm --dir apps/web build
python tools/okf_relation_lint.py --manifest okf-base.yaml
python -m okflint validate --manifest okf-base.yaml
```

## Out Of Scope

- Claim-level validation against OKF vs. RAG conflicts (Stage 7).
- Aviation-specific authority/effectivity rules (Stage 8).
- Load/performance testing of the linear directory scan in
  `retrieveOkfBundleEvidence` against a large `knowledge/` bundle - flagged as
  a future scaling question, not a Stage 6.5 correctness concern.

## Notes

- Baseline before adding new tests: `pnpm --dir apps/web test` -> 255 tests,
  255 passing, 0 failing (2026-07-06).
- All "Gap" unit test rows (U6-U10, U17-U20, U22-U24, U34-U36) have been
  implemented in `okf-frontmatter.test.mts`, `okf-bundle-retriever.test.mts`,
  and `chat-retrieval.test.mts`. Post-implementation: `pnpm --dir apps/web
  test` -> 270 tests, 270 passing, 0 failing; `pnpm --dir apps/web lint` ->
  clean.
- U21 (path-traversal defense-in-depth via `fullPath.startsWith(root)`) was
  **not** implemented as an automated test: triggering it requires a symlink
  pointing outside the resolved bundle root, which needs elevated privileges
  to create reliably on Windows and would be flaky in CI. The guard remains
  in place in `okf-bundle-retriever.ts` as defense-in-depth; treat this as a
  manual/code-review-only check rather than a unit test gap.
- U38 was already covered by the existing `okf-relations.test.mts` suite
  (`relation_target_type_mismatch` case) - no new test needed.
- Integration/manual test matrix (I1-I8) executed 2026-07-06. See findings
  below.

### Manual pass findings (2026-07-06)

- **Scoring gap (I2 could not be reproduced as designed):** `scoreCandidate`
  in `okf-bundle-retriever.ts` does not filter English stopwords ("the",
  "is", "of", "for", "and", ...) out of the query before substring-matching
  against title/description/metadata/body, and any candidate with
  `score > 0` is returned. With only one approved topic in the bundle, two
  different canonical-shaped questions on totally unrelated subjects
  ("cabin pressurization system checks", "galley water heater leak
  troubleshooting") both spuriously matched "Main Gear Brake System" and
  were presented as `APPROVED - OKF` evidence, purely because the questions
  shared common words like "system"/"the" with the topic's frontmatter and
  body text. The downgrade-to-RAG-discovery path only triggered when the
  query was gibberish with zero word overlap (which the router itself
  rejects as `missing_context` before retrieval even runs) or when the
  approved topic was literally the only thing removed/unapproved (I5, I8).
  In a workspace with more than one approved topic this risk narrows
  (a genuinely relevant topic would usually out-score an accidental
  stopword-only match), but with a single-topic or sparse bundle - which is
  exactly the state most workspaces start in - this means an OKF-only
  answer can present unrelated approved content as authoritative for a
  question it doesn't actually answer. This is a precision gap worth a
  follow-up (minimum score threshold, stopword filtering, or requiring at
  least one non-stopword term match) rather than a Stage 6.5 wiring defect -
  the retriever is correctly reading `knowledge/` live and correctly
  gating on `review_status: approved`; it's the relevance scoring that's too
  permissive.
- **RAG retrieval did not error without an OpenAI key**, contrary to the
  `verify` skill's stated expectation. Both hybrid (I3) and RAG-only (I4)
  routes returned zero results gracefully instead of throwing
  `missing_env_OPENAI_API_KEY`. Likely explanation: this workspace had zero
  indexed documents/chunks, so the embedding/search path short-circuited
  before calling OpenAI. Not investigated further since it isn't a
  regression - just note that the "citations found" RAG happy path still
  wasn't observed live in this pass (as the skill anticipated), and neither
  was the RAG-credentials-failure path, since both require documents to be
  uploaded and indexed first.
- One pre-existing, unrelated error appeared once in server logs at initial
  dashboard load: `missing_env_S3_ACCESS_KEY_ID` (MinIO/S3 was not
  configured in the throwaway verify env, since no document upload was
  needed for this pass). Not related to the OKF bundle retriever change.
- No browser console errors or unexpected server errors occurred during any
  of the I1-I8 chat requests themselves (confirmed via server request log:
  every `/chat` GET/POST returned `200`/`303`).

### Regression command results (2026-07-06)

```text
pnpm --dir apps/web test    -> 270 tests, 270 pass, 0 fail
pnpm --dir apps/web lint    -> pass
AV_OKF_TEST_AUTH_ENABLED=false pnpm --dir apps/web build -> pass (same pre-existing
  Turbopack NFT warning around okf-relations.ts as the Stage 6 test plan noted)
python tools/okf_relation_lint.py --manifest okf-base.yaml -> pass, 0 violations
python -m okflint validate --manifest okf-base.yaml        -> pass, all files conformant
```

Verify environment was fully torn down after this pass: dev server process
killed, `verify-postgres`/`verify-redis` Docker containers removed,
`.env.verify` and `.claude/launch.json` deleted, `apps/web/.next` removed,
`knowledge/` confirmed byte-identical to its pre-test state via `git status`.

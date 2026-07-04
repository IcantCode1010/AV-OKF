# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

AV-OKF is a document intelligence platform: upload PDFs, extract page-level text, generate human-reviewable "topic" records from document structure, export approved topics to an OKF (Open Knowledge Format) Markdown bundle, index raw + approved content for RAG search, and route chat questions to OKF, RAG, Hybrid, or missing-context handling. Aviation maintenance (Boeing 737NG) is the first domain pack proving the architecture under high-trust, citation-required constraints, but the core platform is meant to stay domain-generic.

The three-layer model referenced throughout the code and docs:

```text
RAG = broad discovery across raw documents
OKF = curated, structured, stable knowledge (human-approved, Markdown, git-reviewable)
Tools/APIs = live state and actions
```

Read `docs/roadmap/mvp-stages.md` before working on any feature — it defines what each numbered "Stage" (0 through 8) delivers, its exit criteria, and known limitations. Check `CHANGELOG.md`'s Unreleased section for what's currently in flight and which pieces are deliberately still stubs (e.g. chat currently returns a stubbed placeholder reply — the query router exists but real OKF/RAG retrieval wiring is a later stage).

## Repository layout

- `apps/web/` — the Next.js 16 / React 19 product (all active engineering happens here)
- `knowledge/` — the actual exported OKF bundle (Markdown files with frontmatter, `index.md`, `source_manifest.md`, `log.md`)
- `okf-base.yaml` — the OKF manifest: allowed relation types, per-file-type required/optional frontmatter, status values
- `tools/okf_relation_lint.py` + `tests/test_okf_relation_lint.py` — deterministic relation/link lint for the OKF bundle (Python, no repo-level deps beyond stdlib; run with `python3 tools/okf_relation_lint.py --manifest okf-base.yaml` or `python3 -m unittest tests/test_okf_relation_lint.py`)
- `.github/workflows/okflint.yml` — CI gate that pip-installs `okflint` (external PyPI package) and runs `okflint validate --manifest okf-base.yaml` plus the relation lint
- `docs/architecture/` — design notes for okflint profile, link resolution, typed relations, query router, validation agent
- `docs/roadmap/mvp-stages.md` — the authoritative stage-by-stage plan and exit criteria
- `docs/deployment/vps-production.md` — Docker/VPS deployment details

## Commands (apps/web)

All work happens with `apps/web` as the pnpm project root.

```bash
pnpm --dir apps/web dev              # start dev server
pnpm --dir apps/web lint             # eslint
pnpm --dir apps/web build            # production build
pnpm --dir apps/web test             # run all tests (node's built-in test runner)
pnpm --dir apps/web db:generate      # prisma generate
pnpm --dir apps/web db:migrate       # prisma migrate deploy
pnpm --dir apps/web worker           # run the extraction worker (tsx src/worker/extraction-worker.ts)
```

Run a single test file directly (the `test` script is just a glob over this same command):

```bash
cd apps/web
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types --test src/lib/topic-records.test.mts
```

Tests are colocated `*.test.mts` files next to the module under test (e.g. `src/lib/okf-export.ts` / `src/lib/okf-export.test.mts`) and use Node's native `node:test` runner — no Jest/Vitest config to look for.

## Local dev vs. production backend

The single most important architectural fact: **every core feature has two backend implementations, selected by `AV_OKF_BACKEND`.**

- Default (unset / not `"production"`): a local JSON-file "vault" fixture at `apps/web/.data/document-vault.json` plus files under `apps/web/.data/uploads/`, with mock auth (`requireAuthWorkspaceContext()` in `src/lib/auth-workspace.ts` returns a hardcoded demo workspace/user without touching a DB). In-process detached extraction (`src/lib/document-extraction.ts`) runs in the same long-lived Node process instead of a queue.
- `AV_OKF_BACKEND=production`: Postgres (via Prisma) + Redis/BullMQ + S3-compatible object storage (MinIO in Docker Compose), real Auth.js sessions, and a separate worker process (`src/worker/extraction-worker.ts`).

This split is implemented as a facade pattern: `src/lib/document-backend.ts`, `src/lib/chat-backend.ts`, and `src/lib/rag-backend.ts` are the public entry points every route/action imports. Each one branches on `isProductionBackend()` (from `production-document-service.ts`) to call either the local-vault functions (`document-vault.ts`) or the production service (`production-document-service.ts` → `production-repository.ts`, `production-chat-service.ts` → `production-chat-repository.ts`). When adding or changing a document/topic/chat operation, check whether both sides of this split need the change — chat has no local-vault side by design (it reports itself unavailable outside production; see the comment in `chat-backend.ts`), but documents/topics do.

Auth/workspace scoping is pushed down to the repository layer: production repository methods take an `AuthWorkspaceContext` (`{ role, userId, workspaceId }`) and filter Prisma queries by `workspaceId` rather than relying on callers to remember to scope. `assertWorkspaceAccess()` in `auth-workspace.ts` is the guard for record-level checks. New production data-access code should follow this pattern rather than trusting the caller.

## Document → knowledge pipeline

The pipeline stages, and where each lives in code:

1. **Upload** (`documents/actions.ts`) → stored via `ObjectStorage` abstraction (`production-storage.ts`, local disk in dev) under opaque keys `workspaces/{workspaceId}/documents/{documentId}/original/{uuid}.pdf`.
2. **Extraction** (`pdf-text-extractor.ts`, `document-extraction.ts`, `extraction-worker.ts`) → page-level text/table/image records, normalized failure modes (`malformed_pdf`, `password_protected_pdf`, `missing_stored_pdf`, `extraction_failed`). Known limitation: extraction does not detect multi-column layout, which corrupts both text and downstream heading detection (see `mvp-stages.md` Stage 2).
3. **Topic generation** (`topic-records.ts`) → heading/TOC/page-range-derived "topic" candidates with categorical confidence (`high`/`medium`/`low`), triggered manually, never automatically after re-extraction. Reruns delete `needs_review`/`needs_cleanup` topics, preserve `approved`/`rejected` ones, and skip drafts overlapping already-reviewed page coverage.
4. **Review** (`documents/actions.ts`, `document-tree-nav.tsx`, `document-detail-panels.tsx`) → human approve/reject/cleanup; optional LLM enrichment (`topic-enrichment.ts`, provider-selected via `llm-providers.ts` / `llm-provider-settings.ts`) with full audit trail (`TopicEnrichmentAudit`) and an explicit raw-vs-enriched approval choice.
5. **RAG indexing** (`rag-chunker.ts`, `rag-indexer.ts`, `rag-repository.ts`, `embedding-provider.ts`) → runs immediately after extraction, independent of and prior to topic review/approval; production uses OpenAI `text-embedding-3-small` against Postgres+pgvector, tests use a deterministic local embedding provider (no API key needed). Pre-call token budgets (`rag-budget.ts`) are enforced before any embedding API call — a budget breach fails indexing explicitly (`embedding_budget_exceeded`) rather than silently truncating.
6. **OKF export** (`okf-export.ts`, `okf-export-service.ts`, `okf-bundle.ts`, `okf-relations.ts`) → approved topics only, written as Markdown with frontmatter conforming to `okf-base.yaml`, plus `index.md`/`source_manifest.md` regeneration.
7. **OKF-to-RAG coverage** (`okf-coverage.ts`, `okf-rag-sync.ts`) → on export, approved topics resolve which RAG chunks overlap their source pages, writing `covered_rag_chunk_ids`/`coverage_type` into frontmatter and syncing `OkfConceptChunkLink`; approved topics are also indexed as their own `okf_topic` RAG chunks distinct from raw extraction chunks.
8. **Chat routing** (`chat-router.ts`, `chat-backend.ts`, `production-chat-service.ts`) → a rules-first classifier maps a question to `okf_only` / `rag_only` / `hybrid` / `missing_context` / `unsupported` before any retrieval runs; the router trace (category, route, confidence, rationale) is meant to be inspectable per the Stage 6 design in `docs/architecture/query-router.md`. As of the latest stage, retrieval/answer-building beyond the router itself is still a stub — check `CHANGELOG.md` for current state before assuming retrieval is wired up.

RAG chunks and OKF topics are deliberately separate concepts throughout this pipeline: RAG chunks optimize for retrieval, OKF topics optimize for reviewed meaning. Don't conflate them when adding features.

## OKF bundle conventions

- OKF files are Markdown with YAML frontmatter; required/optional fields per `type` (e.g. `aircraft_index`, `manual_category`) are declared in `okf-base.yaml`, not a hand-rolled schema checker — the CI-installed `okflint` PyPI package enforces this.
- `relations` is a typed field using a controlled vocabulary (`routes_to`, `references`, `supports`, `covered_by`, `supersedes`, `conflicts_with`, `depends_on`), each relation target declaring a `target_type` that must match the resolved target file's frontmatter `type`. `tools/okf_relation_lint.py` enforces target resolution and type matching deterministically (no LLM in the loop).
- Status values are tracked per-file under `review_status` (`raw_extracted`, `needs_ai_cleanup`, `needs_human_review`, `approved`, `rejected`, `deprecated` — exact set varies by type, see `okf-base.yaml`).
- When approved OKF content conflicts with raw RAG evidence, OKF is meant to be treated as authoritative (this is a Stage 7 validation rule, not yet fully implemented — check current stage before assuming it's enforced at runtime).

## Docker/VPS deployment shape

`docker-compose.yml` at the repo root wires: `caddy` (public reverse proxy, port 3000) → `web` (Next.js) + `worker` (extraction worker), backed by `postgres`, `redis` (BullMQ), and `minio` (S3-compatible object storage), plus a one-shot `migrate` service for Prisma migrations. Only Caddy is published to the host; Postgres/Redis/MinIO are internal-only. This is a single-node architecture — multi-worker deployment relies on BullMQ locking and idempotent job IDs (`extract:{documentId}:{extractionJobId}`), and there's no serverless-compatible path yet (see `docs/deployment/vps-production.md`).

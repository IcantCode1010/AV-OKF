# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

### Changed

- Reframed the upcoming topic workflow: after PDF upload and text extraction, an LLM should review the extracted document text, propose draft topic records with source sections/pages, let the reviewer tweak those topics, optionally enhance an individual topic with the LLM, and only then allow human approval/export to OKF.
- Added workspace-level Anthropic API key settings for future AI enrichment. Keys are encrypted at rest, managed from Settings, and never displayed back to the client after save.
- Added on-demand LLM topic enrichment for unapproved topics, including side-by-side raw/enriched review, explicit raw-vs-enriched approval choice, and a full audit trail of prompt, raw response, provider, model, requester, success state, and error message.
- Added OpenAI as a second LLM enrichment provider alongside Anthropic. Workspace Settings now offers a provider dropdown instead of a fixed Anthropic field; `topic-enrichment.ts` selects the matching provider implementation via a factory keyed on the workspace's saved provider, and switching providers replaces the single stored key rather than keeping both.
- Condensed the document detail page into a tree-nav layout: `document-tree-nav.tsx` presents Summary/Metadata/Extraction/Topics/Logs as a collapsible tree (with a flattened mobile view), and the previous ~950-line monolithic page now renders panel content from the new `document-detail-panels.tsx`.
- Added approved-OKF-topic-to-RAG sync (`okf-rag-sync.ts`): approved topics are indexed as their own `okf_topic` search chunks, separate from raw extraction chunks, with content-hash change detection to skip re-syncing unchanged topics. Triggered from the admin Reindex page, which now also reports synced/unchanged/failed counts. Search results display an "OKF topic" vs "raw extraction" source badge.
- Implemented Stage 5 OKF-to-RAG coverage links (`okf-coverage.ts`): on export against the production backend, approved topics resolve which active raw-extraction RAG chunks overlap their source pages, write that list to `covered_rag_chunk_ids`/`coverage_type` frontmatter, and sync it into `OkfConceptChunkLink` (stale links removed on re-export). `searchKeyword`/`searchVector` now populate `RetrievalResult.coveredByOkfConceptIds` from that table instead of hardcoding `[]`. Local JSON-vault exports skip resolution, since they have no RAG chunks.
- Added extraction and topic-generation activity feedback to the document detail page: a header line shows extraction start/finish timestamps and page count on every tab (not just Extraction), the Summary tab's extraction tile shows real counts/timestamps instead of a static string, and the document now defaults to the Topics tab (with an actionable "Generate topics" prompt) as soon as extraction completes, instead of staying on an unchanging Summary tab. "Generate topics" now shows a completion banner reporting the resulting topic count.
- Improved Stage 3 heading-detection quality after a real 737 QRH document (402 pages) produced 368 topics, most single-page with obscure titles like `"Lights.Index.5"` or bare `"0.1"`. `topic-records.ts` now: requires numbered headings to have real trailing title text (not just a bare digit); rejects bare page-index/cross-reference codes (`"0.1"`), single-token dotted codes (`"Lights.Index.5"`), dot-leader index/TOC entries (`"LOW QUANTITY.......13.13"`), and bare 1-3 letter lines (alphabetical-index dividers like `"D"`, or truncated print artifacts like `"REV"` that precede the real heading on the next line); and assigns `medium` confidence (previously unused) to the weaker short-line heading heuristic, reserving `high` for ALL-CAPS/explicitly-numbered matches. Verified against the real QRH document: 368 → 341 → 332 topics, with the originally-reported junk patterns eliminated.

### Fixed

- Document library rows were intermittently unclickable. Root cause was Next.js 16's client-side router silently failing to commit some navigations (reproduced even on a bare `next/link` click with no custom code involved). `document-library.tsx` now navigates with a plain `<a href>` and `window.location.assign()` instead of `next/link` and `router.push()`, forcing a full browser navigation for this list.
- `document-row-navigation.ts`'s click-ignore selector didn't exclude anchor tags, so a click landing on the title link could double-fire both the link's own navigation and the row's programmatic navigation to the same URL. Anchor tags are now excluded.
- Removed an `approved` OKF topic (`32-apu-ecu-monitors-apu-performance-parameters-to-determine-*.md`) whose title/description was raw, truncated extraction text rather than a real section heading. The source pages have a multi-column layout that the Stage 2 heading detector misread; the topic is now `rejected` in the vault fixture and removed from the knowledge bundle's `index.md`/`source_manifest.md`, with the retraction recorded in `log.md`.
- Docker Compose's `web` and `worker` services didn't load `apps/web/.env`, so search embeddings had no provider credentials at runtime; both services now load that env file, and the compose file no longer separately threads a stale `OPENAI_API_KEY` default.

### Documentation

- Noted a known Stage 2 limitation in `docs/roadmap/mvp-stages.md`: text extraction does not detect multi-column page layout, which can corrupt both extracted text and Stage 3 heading detection.
- Added `docs/superpowers/plans/2026-07-02-stage-5-coverage-links.md`, scoping the still-unimplemented OKF-to-RAG coverage link work (the `OkfConceptChunkLink` table and `coveredByOkfConceptIds` field already exist from Stage 4 but nothing populates or reads them yet).
- Updated the Stage 5 roadmap entry and MVP demo flow to describe the bundle-first Knowledge page and folder-style OKF bundle explorer.
- Updated the Stage 3 confidence note in `docs/roadmap/mvp-stages.md` to reflect that `medium` is now actively produced for the short-line heading heuristic (previously "reserved for later"), and documented the page-index-code rejection behind the QRH heading-detection fix.

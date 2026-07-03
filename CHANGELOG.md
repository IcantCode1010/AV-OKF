# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

### Changed

- Reframed the upcoming topic workflow: after PDF upload and text extraction, an LLM should review the extracted document text, propose draft topic records with source sections/pages, let the reviewer tweak those topics, optionally enhance an individual topic with the LLM, and only then allow human approval/export to OKF.
- Added workspace-level Anthropic API key settings for future AI enrichment. Keys are encrypted at rest, managed from Settings, and never displayed back to the client after save.
- Added on-demand LLM topic enrichment for unapproved topics, including side-by-side raw/enriched review, explicit raw-vs-enriched approval choice, and a full audit trail of prompt, raw response, provider, model, requester, success state, and error message.

### Fixed

- Document library rows were intermittently unclickable. Root cause was Next.js 16's client-side router silently failing to commit some navigations (reproduced even on a bare `next/link` click with no custom code involved). `document-library.tsx` now navigates with a plain `<a href>` and `window.location.assign()` instead of `next/link` and `router.push()`, forcing a full browser navigation for this list.
- `document-row-navigation.ts`'s click-ignore selector didn't exclude anchor tags, so a click landing on the title link could double-fire both the link's own navigation and the row's programmatic navigation to the same URL. Anchor tags are now excluded.
- Removed an `approved` OKF topic (`32-apu-ecu-monitors-apu-performance-parameters-to-determine-*.md`) whose title/description was raw, truncated extraction text rather than a real section heading. The source pages have a multi-column layout that the Stage 2 heading detector misread; the topic is now `rejected` in the vault fixture and removed from the knowledge bundle's `index.md`/`source_manifest.md`, with the retraction recorded in `log.md`.

### Documentation

- Noted a known Stage 2 limitation in `docs/roadmap/mvp-stages.md`: text extraction does not detect multi-column page layout, which can corrupt both extracted text and Stage 3 heading detection.
- Added `docs/superpowers/plans/2026-07-02-stage-5-coverage-links.md`, scoping the still-unimplemented OKF-to-RAG coverage link work (the `OkfConceptChunkLink` table and `coveredByOkfConceptIds` field already exist from Stage 4 but nothing populates or reads them yet).
- Updated the Stage 5 roadmap entry and MVP demo flow to describe the bundle-first Knowledge page and folder-style OKF bundle explorer.

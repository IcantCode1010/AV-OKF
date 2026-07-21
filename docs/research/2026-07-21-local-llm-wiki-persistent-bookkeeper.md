# Local LLM Wiki As A Persistent Knowledge Bookkeeper

## Source

- URL: https://www.youtube.com/watch?v=aGXTV5MTqDY
- Author / Publisher: User-supplied YouTube video and transcript
- Date reviewed: 2026-07-21
- Topic: Turning source documents and AI-assisted synthesis into a persistent, interlinked Markdown knowledge base

## Summary

The video proposes replacing temporary chat context with a local, persistent LLM-maintained wiki. Original files live in an immutable `raw sources` area. The AI reads those sources, creates structured Markdown summaries in a separate wiki, updates `index.md`, appends changes to `log.md`, and cross-links related concepts. Useful question-and-answer synthesis can be saved as new wiki pages instead of disappearing into chat history. A periodic lint pass checks links, tags, formatting, and frequently mentioned concepts that do not yet have dedicated pages.

The central idea is that AI conversations should compile durable knowledge artifacts instead of repeatedly rebuilding context in isolated chat sessions.

## Key Ideas

- Keep original source files separate from AI-authored knowledge and never let the AI modify the originals.
- Use a schema or instruction file as the operating contract for structure, formatting, and allowed actions.
- Make ingestion update concept pages, links, an index, and an append-only change log.
- Save valuable cross-source synthesis as a durable concept rather than leaving it only in chat history.
- Run periodic maintenance to find broken links, duplicate tags, inconsistent formatting, and missing concept pages.
- Treat the knowledge directory as a codebase: source-controlled structure, deterministic conventions, linting, and reviewable changes.

## Relevance To AV-OKF

AV-OKF already implements the stronger, governed form of most of this pattern:

```text
uploaded PDF / extracted pages (preserved source)
  -> LLM-assisted concept discovery and enrichment
  -> human or explicitly configured automation review
  -> typed OKF Markdown concepts
  -> index.md, source_manifest.md, and append-only log.md
  -> live OKF retrieval with raw RAG as labeled discovery support
```

The video's `schema.md` role maps to each bundle's versioned `okf-base.yaml` profile. Its raw-source/wiki boundary maps to the project's source-preserving bundle lifecycle: deleting a bundle removes derived knowledge but retains PDFs and extraction history as Unassigned documents. Its index, log, cross-linking, and graph ideas map directly to the current Knowledge Explorer and typed relations.

## What AV-OKF Can Gain

### 1. Promote useful chat synthesis into a reviewed draft

The clearest missing workflow is a `Save as draft concept` action on an assistant answer. It should:

- preserve the answer's verified citations and source pages;
- create a draft topic in the current bundle;
- record which concepts and raw sources were synthesized;
- require the existing enrichment, validation, and approval/export path;
- never write directly to approved OKF files.

This would let user questions improve the knowledge base without weakening its trust model.

### 2. Add a bundle maintenance pass

The existing validators cover structural conformance and typed relations. A reviewer-facing maintenance workflow could additionally propose:

- missing concept pages for frequently cited subjects;
- duplicate or near-duplicate concepts and tags;
- stale concepts after source revisions;
- contradictory approved concepts;
- unlinked concepts and weak graph neighborhoods.

Findings should be proposals, not automatic edits to approved knowledge.

### 3. Add a source inbox later

A browser clipper or source inbox could accept web articles and Markdown alongside PDFs. This is useful for general-purpose bundles, but it requires source capture, provenance, content-type extraction, and authorization rules. It is a later ingestion enhancement, not a reason to bypass the current document pipeline.

## Product Impact

Confirms the current architecture and suggests a minor future roadmap extension.

The source/knowledge boundary, profile contract, generated index and log, graph relations, and persistent bundle model are already implemented. The next useful adaptation is reviewed chat-to-concept promotion, followed by bundle-maintenance diagnostics. The informal model of letting an AI freely rewrite the wiki should not be adopted because AV-OKF distinguishes approved evidence from drafts and keeps deletion human-controlled.

## Recommended Action

1. Keep the existing governed ingestion and export architecture unchanged.
2. Add `Save as draft concept` as a future reviewed authoring slice after current lifecycle work is stable.
3. Add reviewer-facing bundle maintenance diagnostics that build on `okflint`, relation lint, lifecycle state, and source revision data.
4. Consider a source inbox or web clipper only after non-PDF provenance and extraction rules are designed.
5. Continue prohibiting agents from approving relations, retracting knowledge, or deleting sources and bundles.

## Related Project Areas

- Source document vault
- LLM-assisted authoring
- Topic records
- OKF bundle profiles
- Knowledge Explorer
- Typed relations and graph
- Chat citations
- Bundle validation and lifecycle

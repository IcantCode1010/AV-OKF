# Chat Entity Discovery

## Purpose

Chat may reveal a reusable named entity that is present in retrieved evidence
but does not yet have its own knowledge page. The agent may propose that entity
for review; it may not write approved knowledge directly.

The first supported flow is:

```text
Supported chat answer
-> source-quoted entity suggestion
-> user selects Review and enrich
-> needs_review entity topic
-> existing enrichment and approval workflow
-> existing OKF export workflow
```

## Trust Boundary

- Entity suggestions are emitted only with an LLM-synthesized answer that
  passes the existing deterministic answer-evidence validator.
- Each suggestion must name one persisted citation and include an exact quote
  from that citation's fuller retrieval evidence.
- The entity name must appear inside the exact quote.
- Unknown citation indexes, altered quotes, duplicates, malformed output, and
  unsupported entity types are discarded.
- Suggestions are trace data, not evidence. They cannot be cited, traversed,
  searched as OKF, or shown as approved knowledge.
- Selecting a suggestion creates a `needs_review` topic. It does not enrich,
  approve, export, relate, or activate that topic.

## Entity Types

The initial domain-neutral vocabulary is:

- `person`
- `organization`
- `product`
- `standard`
- `regulation`
- `location`
- `system`
- `other`

Built-in Generic and Aviation profiles expose `entity` as an OKF type and
`entity_type` as optional metadata. Custom profiles must explicitly allow the
`entity` type before chat suggestions can be promoted.

## Source Resolution

Raw RAG suggestions resolve through the citation's workspace-scoped document
ID. Approved OKF suggestions resolve through the workspace, bundle, approved
topic, and normalized `exportedFilePath`. The source document must still be
active and assigned to the cited bundle.

Only extracted pages within the persisted citation range become authoritative
source pages. If the document or pages are unavailable, promotion fails without
creating a topic.

Entity topic IDs are deterministic by bundle and normalized entity name.
Repeated or concurrent promotion resolves to the existing topic rather than
creating duplicate entity records.

## Deferred Work

- Bundle-level entity registry and alias resolution.
- Cross-document entity merging and multi-source provenance.
- Deterministic named-entity recognition before the optional LLM pass.
- Entity-specific explorer views and graph styling.
- Suppressing already-known entities before rendering suggestions.
- Entity enrichment that deliberately compares multiple approved sources.

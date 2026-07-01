# OKF Plus RAG Hybrid Knowledge Stack

## Source

- URL: pasted transcript supplied by user
- Author / Publisher: Cloud Codes / unknown transcript source
- Date reviewed: 2026-07-01
- Topic: OKF and RAG as complementary memory layers for agents

## Summary

This source argues that the useful production architecture is not OKF versus RAG, but OKF plus RAG. OKF should hold the curated, structured, high-trust knowledge that agents cannot afford to get wrong. RAG should handle the messy, large, open-ended long tail that cannot realistically be curated by hand.

The source frames OKF as the canonical "80%" and RAG as the long-tail "20%". The exact percentages are not literal, but the architectural split is useful: curated stable knowledge belongs in OKF, while exploratory discovery across broad archives belongs in RAG.

## Key Ideas

- RAG is powerful for semantic discovery across large messy corpora.
- RAG can fail when chunking destroys structure, sequence, tables, procedures, or clauses.
- RAG retrieval is probabilistic: it returns likely relevant chunks, not guaranteed authoritative answers.
- OKF preserves curated structure using Markdown, YAML frontmatter, links, Git history, and review.
- OKF is best for exact, stable, high-stakes knowledge.
- OKF does not scale automatically because each concept needs curation.
- The winning architecture uses a router in front of both systems.
- OKF can provide ground truth and navigation context for RAG.
- RAG extends OKF by covering the raw archive and long-tail questions.
- Large context windows do not remove the need for routed retrieval because irrelevant context can degrade answers and increase cost.

## Relevance To AV-OKF

This source directly supports the current AV-OKF architecture:

```text
OKF = curated spine
RAG = long-tail reach
Agent router = query-by-query decision layer
Validator = trust and evidence gate
```

It also validates the decision to build a generic document platform rather than a narrow aviation-only chatbot. Any serious document intelligence system needs both curated knowledge and raw retrieval.

## Product Impact

Confirms current direction with a minor roadmap emphasis.

No major architecture change is needed. The note strengthens the need for an explicit query router and retrieval mode labels in the chat UI.

## Recommended Action

Keep the roadmap order, but make these requirements explicit in Stage 6:

- Add a query router before retrieval.
- Label every chat answer as `OKF`, `RAG`, or `Hybrid`.
- Prefer approved OKF when a direct canonical answer exists.
- Fall back to RAG when the question is exploratory, broad, comparative, or not covered by approved OKF.
- Use hybrid mode when OKF provides the governing concept and RAG provides supporting examples or raw evidence.
- Store retrieval mode and routing rationale in the agent trace.

## Routing Model

Recommended MVP retrieval modes:

```text
okf_only
rag_only
hybrid
insufficient_context
```

Recommended query categories:

```text
canonical_definition
policy_or_process
source_lookup
open_ended_discovery
cross_document_summary
comparison
high_risk_domain
missing_context
```

Routing rule:

```text
If the question asks for stable, official, reviewed knowledge:
  use OKF first.

If the question asks for broad search, examples, similar cases, summaries, or unknown material:
  use RAG first.

If the question is high-risk or domain-specific:
  use hybrid retrieval plus validation.

If the required source or context is missing:
  return a missing-evidence answer instead of guessing.
```

## Related Project Areas

- RAG retrieval
- OKF bundle
- Chat agent
- Agent trace
- Validation
- Review workflow
- Domain packs

## Notes For Product Positioning

Avoid positioning AV-OKF as "chat with PDFs." The stronger positioning is:

```text
A document intelligence platform that separates curated knowledge from raw search, then lets an agent use both with citations and validation.
```

This makes the product more defensible than a generic RAG interface.


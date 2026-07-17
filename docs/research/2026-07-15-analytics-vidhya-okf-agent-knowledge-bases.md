# OKF: Redefining Knowledge Bases for AI Agents

## Source

- URL: https://www.analyticsvidhya.com/blog/2026/07/open-knowledge-format-okf/
- Author / Publisher: Shaik Hamzah / Analytics Vidhya
- Published: 2026-07-08
- Date reviewed: 2026-07-15
- Topic: OKF concept bundles, agent traversal, and hybrid OKF/RAG architecture
- Normative reference checked: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md

## Summary

The article presents OKF as a curated, agent-readable knowledge layer made from Markdown concepts, YAML frontmatter, and explicit links. It contrasts that with RAG, which remains better for semantic discovery across large collections of raw and frequently changing documents.

Its recommended architecture is a router in front of both systems:

```text
authoritative or stable question -> OKF concept traversal
exploratory or historical search -> RAG
question needing both -> OKF plus supporting RAG
```

The article also emphasizes progressive disclosure: an agent reads `index.md`, selects a concept, opens that file, follows links when more context is needed, and answers from the resulting focused context.

## Key Ideas

- RAG chunking weakens document structure and separates relationships that existed in the source.
- OKF preserves reviewed concepts and relationships explicitly rather than recreating them from similarity on every query.
- One concept per file keeps knowledge maintainable and limits the context an agent needs to read.
- `index.md` is an agent entry point, not just a human table of contents.
- Explicit links form a navigable graph for cross-concept questions.
- OKF and RAG are complementary: curated organisational knowledge belongs in OKF; broad raw-document discovery belongs in RAG.
- Git-friendly Markdown improves review, versioning, portability, and auditability.

## Relevance To AV-OKF

This directly confirms the implemented AV-OKF architecture:

```text
raw PDFs -> extracted pages -> raw RAG discovery
reviewed topics -> approved OKF Markdown concepts
live OKF bundle retriever -> direct trusted evidence
typed relation traversal -> cross-concept evidence
router -> OKF, RAG, Hybrid, missing context, or unsupported
validator -> citation and evidence contract enforcement
```

AV-OKF is already stricter than the tutorial in several useful ways:

- OKF concepts require human approval before trusted export.
- Relations have controlled types and target-type validation.
- Source files and page ranges are retained.
- Lifecycle state can exclude archived, retracted, or deleted concepts.
- Raw RAG is visibly labeled as unreviewed discovery.
- Chat persists routing, retrieval, evidence, answer, and validation traces.

The article reinforces the planned Stage 7C bounded tool layer. In particular, the future agent should have a progressive-disclosure operation such as `readOkfIndex` or `listOkfConcepts` in addition to `searchOkf`, `readOkfFile`, and `followOkfRelation`.

## Specification Cautions

The article is a useful tutorial, but it is not the normative specification.

- It describes optional `CHANGELOG.md`; OKF v0.1 actually reserves optional `log.md`.
- Official OKF reserves `index.md` and `log.md`. AV-OKF's `source_manifest.md` is a deliberate profile extension, not a base-spec reserved filename.
- Official OKF permits both bundle-root absolute links and relative links, and recommends bundle-root absolute links. The AV-OKF profile currently permits relative links only for deterministic renderer compatibility. That stricter rule is intentional but should be documented as an interoperability profile difference.
- The official specification requires only non-empty `type` frontmatter for concepts. AV-OKF's additional required metadata is an application/domain profile enforced by `okflint`, not a claim about base OKF conformance.
- Official consumers must tolerate unknown types and broken links. AV-OKF may reject unresolved operational relations more strictly because trusted agent traversal depends on them.

## Product Impact

Confirms the current direction with one minor future adjustment.

No retrieval or storage architecture change is needed. The live OKF bundle should remain the reviewed source of truth, and raw RAG should remain a separate discovery layer.

For Stage 7C and later multi-bundle work, add explicit progressive-disclosure support so an agent can inspect bundle indexes before opening concepts. Keep broad lexical bundle scanning as a deterministic retrieval aid, but do not make it the only way an agent understands bundle structure.

## Recommended Action

### Now

- Continue Stage 7C rather than switching frameworks or replacing RAG.
- Keep OKF retrieval live and uncached for trust-critical lifecycle behavior.
- Keep human approval as the boundary between generated topic drafts and trusted OKF.

### Stage 7C

- Include an index/list operation in the bounded agent tool contract.
- Preserve the current sequence: find concept, read concept, follow approved relations, use coverage-linked RAG, then use broad raw RAG only if still needed.
- Record every file and relation traversed in the chat trace.

### Multi-Bundle Stage

- Treat each bundle as a portable unit with its own root index and lifecycle.
- Support nested concept directories even if the first bundle remains physically flat.
- Define import normalization for official bundle-root absolute links versus the stricter AV-OKF relative-link profile.

## Related Project Areas

- OKF bundle
- Query router
- Bounded agent tools
- Typed relation graph
- RAG discovery
- Validation and citations
- Multi-bundle storage
- Bundle interoperability

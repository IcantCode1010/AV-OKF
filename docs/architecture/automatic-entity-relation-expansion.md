# Automatic Entity and Relation Expansion

## Purpose

AV-OKF extracts grounded entities and local relationship assertions after topic
enrichment without enlarging the topic-authoring prompt. The stage is
non-blocking: entity or relation failures appear as retryable warnings and do
not prevent a valid topic from reaching review or export.

```text
Topic enrichment
-> bounded entity extraction
-> workspace identity reconciliation
-> topic approval and OKF export
-> bundle-local incremental expansion
-> one-pair relation verification
-> human review or strictly gated automatic publication
```

## Trust Boundaries

Canonical entities are workspace-wide bookkeeping identities. Their
occurrences, classifications, topic links, candidate relations, and retrieval
scope remain bundle-specific. A provisional or auto-registered entity is not
approved knowledge, cannot be cited, and cannot participate in agent graph
traversal.

The **Entity map** is a rebuildable structural projection of entity mentions,
documents, topics, aliases, and unresolved assertions. The **Published
knowledge** graph continues to use active typed relations exported in OKF
frontmatter as its source of truth.

## Grounding And Resolution

Every extracted entity or relation assertion is bound to known RAG chunks,
pages, a content hash, and an exact canonicalized source quote. Relationship
assertions may identify a target by explicit name or a uniquely resolved
section/identifier anchor. Unknown chunks, changed quotes, stale hashes,
ambiguous targets, cross-bundle targets, and instructions embedded in source
text fail closed.

One matching document leaves an entity provisional. A matching normalized name
and type from two independent documents may register one canonical entity.
Exact unambiguous aliases may attach automatically; acronyms, fuzzy aliases,
homonyms, and conflicting types require review.

## Expansion And Publication

Publishing a topic schedules one idempotent incremental run for its bundle. A
manual full reconciliation is also available from **Relations**. Runs examine
only approved exported bundle topics, rank a finite candidate set, queue no
more than 50 candidates, and never recurse.

A semantic relation is published automatically only when all conditions hold:

- the bundle profile opts into automatic verified relations;
- `AV_OKF_RELATION_AUTO_PUBLISH_ENABLED=true` enables the global safety gate;
- source and target are active approved exported concepts in the same bundle;
- the source quote and deterministic target resolution validate against current content;
- one-pair LLM verification selects an allowed profile relation and returns a pair-specific rationale;
- confidence is at least 0.95;
- graph preflight passes path, type, lifecycle, duplicate, cycle, symmetric-edge, and supersession checks.

Every profile relation type is eligible under those controls. The defaults keep
bundle automation off, and the global gate must remain off until the configured
multi-document evaluation reaches approximately 90% precision with no known
negative-control regression. With either gate off, confirmed relations remain
reviewable proposals.

## Operations

BullMQ jobs and database records make extraction and expansion retryable and
idempotent. Processing and Activity expose safe counts and errors without
provider prompts, raw responses, or chain-of-thought. Document deletion prunes
its occurrences and supporting evidence; bundle deletion removes bundle-scoped
projections while preserving workspace entities supported by other bundles.


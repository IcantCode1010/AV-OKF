# Bundle Topic Expansion

## Purpose

Topic expansion is a manually initiated, bundle-scoped workflow for finding
subjects that are present across approved knowledge but do not yet have their
own concept. It runs after publication and is deliberately separate from PDF
processing and relation discovery.

```text
Approved OKF concepts
-> one bounded research job per approved topic
-> synonyms and search questions
-> hybrid RAG search and reranking
-> evidence and terminology extraction
-> up to three grounded search rounds
-> up to 10 proposals
-> reviewer selection
-> enrichment confirmation
-> independent enrichment jobs
-> normal topic review and publication
```

## Grounding And Scope

The crawler creates one durable research job for every active, approved,
exported concept in the authenticated workspace and selected bundle. Each job
generates synonyms and direct search questions, runs bundle-scoped vector and
keyword retrieval, applies active/raw-source metadata filters, reranks the
combined results, and examines grounded source chunks coverage-linked to
approved concepts. It extracts supported claims and terminology, then searches
again using those discoveries. A job stops when another search produces no new
chunks, the model reports no meaningful new evidence, no grounded follow-up
query remains, or the three-round limit is reached.

Every proposal must reference known concepts, chunks, pages, content hashes,
and an exact source-text quote. Raw RAG remains unreviewed and cannot become a
proposal unless its chunk is coverage-linked to an approved concept.

A proposal needs support from at least two approved concepts. A one-concept
proposal is allowed only for a substantive explicit subject backed by a
canonical entity occurrence and exact raw evidence. Unknown, stale,
cross-bundle, lifecycle-inactive, fabricated, altered, and prompt-injected
evidence fails closed.

Existing topic titles, accepted aliases, prior proposals, and rejected
fingerprints are suppressed. Discoveries from independent topic jobs are
merged by deterministic identity before a final critic selects only validated
proposal IDs. Stable ranking limits the visible result to 10 proposals.

## Durable Workflow

`TopicExpansionRun` records the versioned corpus fingerprint, estimate,
provider/model, progress, result counts, and failures.
`TopicExpansionResearchJob` records each source topic's content hash, status,
attempts, current stage, search round, heartbeat, query count, grounded chunk
count, stop reason, and validated candidate output. The page reports these
persisted checkpoints in place without exposing generated queries, prompts,
or raw model output. One active run is allowed per bundle, and an unchanged
corpus under the same research version returns the existing run. Worker restart
reconciliation resumes incomplete topic jobs without repeating completed ones.

Selection creates a `TopicExpansionEnrichmentBatch` estimate without calling
the provider. Confirmation creates an unapproved `TopicRecord` for each
proposal and one durable `TopicEnrichmentJob` per topic revision. Jobs use all
validated source evidence, complete independently, retry safely, reconcile on
worker startup, and expose progress through Topic expansion and Activity.
Proposal reservation and atomic promotion claims prevent overlapping
confirmations from creating duplicate topics. Cancellation releases an
unconfirmed selection and stops queued work; an already-running provider call
finishes safely before the batch reaches its terminal state.

Successful drafts appear in Review with a **Topic expansion** origin badge.
They remain `needs_review`. Topic expansion cannot approve, export, publish
relations, or make a proposal available to agent retrieval.

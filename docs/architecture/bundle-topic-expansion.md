# Bundle Topic Expansion

## Purpose

Topic expansion is a manually initiated, bundle-scoped workflow for finding
subjects that are present across approved knowledge but do not yet have their
own concept. It runs after publication and is deliberately separate from PDF
processing and relation discovery.

```text
Approved OKF concepts
-> bounded grounded crawl
-> up to 20 proposals
-> reviewer selection
-> enrichment confirmation
-> independent enrichment jobs
-> normal topic review and publication
```

## Grounding And Scope

The crawler reads only active, approved, exported concepts in the authenticated
workspace and selected bundle. It receives raw chunks already coverage-linked
to each concept's cited pages. Every proposal must reference known concepts,
chunks, pages, content hashes, and an exact source-text quote.

A proposal needs support from at least two approved concepts. A one-concept
proposal is allowed only for a substantive explicit subject backed by a
canonical entity occurrence and exact raw evidence. Unknown, stale,
cross-bundle, lifecycle-inactive, fabricated, altered, and prompt-injected
evidence fails closed.

Existing topic titles, accepted aliases, prior proposals, and rejected
fingerprints are suppressed. The full approved corpus is processed in bounded
18,000-token batches before a final critic selects only validated proposal IDs.
Stable ranking limits the visible result to 20 proposals.

## Durable Workflow

`TopicExpansionRun` records the corpus fingerprint, estimate, provider/model,
progress, result counts, and failures. One active run is allowed per bundle,
and an unchanged corpus returns the existing run.

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

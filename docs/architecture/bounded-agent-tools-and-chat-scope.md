# Bounded Agent Tools And Dynamic Chat Scope

## Purpose

Stages 7C and 7D prepare chat for agent-directed retrieval without giving a
model authority over routing, trust, workspace scope, or writes.

Production chat remains deterministic:

```text
question
-> deterministic route
-> immutable selected-bundle snapshot
-> bounded read-only tool wrappers in the existing fixed order
-> answer generation
-> mandatory deterministic evidence validation
-> persisted answer, citations, scope, and tool trace
```

The model-directed runner is evaluation-only. Enabling free model-directed
tool choice for production is not the next step. The approved middle path is a
single bounded adaptive retrieval retry when deterministic retrieval returns
weak evidence. Any broader model-directed tool choice requires a separate
reviewed decision and a successful comparison against the route-coverage
baseline.

## Tool Boundary

The read-only tool vocabulary is:

- `searchOkf`
- `readOkfFile`
- `followOkfRelation`
- `searchCoveredRag`
- `searchRawRag`
- `readSourcePages`
- `validateAnswerEvidence`

The application creates an immutable execution context containing the
authenticated workspace, selected bundle IDs, deterministic route, and
execution mode. The model cannot supply or replace the workspace ID.

Policy limits:

- at most eight executed calls per turn;
- the evaluation runner reserves the eighth call for mandatory validation;
- at most two graph hops;
- at most five previously referenced source pages;
- four OKF and six raw-RAG results globally across the selected scope;
- no tools for `missing_context` or `unsupported`;
- no OKF tools on `rag_only`;
- raw RAG on `okf_only` is available only through the bounded fallback path.

Later reads are capability-scoped to evidence discovered earlier in the same
turn. A model cannot read an arbitrary OKF path, chunk ID, document, or page.
Unsafe, stale, inactive, unapproved, retracted, archived, cross-workspace, and
unselected sources still fail through the existing repository and lifecycle
guards.

Tool traces store tool name, order, status, bundle IDs, bounded input metadata,
result count, warnings, and safe error codes. They never store API keys, full
provider prompts, or source-page bodies.

## Dynamic Knowledge Scope

A chat session owns an ordered set of one to ten active workspace bundles.
The first selected bundle is the primary/focused bundle. The header selector
can add or remove bundles, but the agent cannot widen scope itself.

Every send operation snapshots:

- ordered selected bundle IDs;
- session `scopeVersion`;
- bundle names in the assistant trace.

That snapshot is persisted on both messages and passed through retrieval,
answer generation, validation, citations, and knowledge-gap capture. A scope
change therefore affects future turns only and cannot alter an in-flight or
historical answer.

Selected bundles are ranked from registry name, description, and live
`index.md` metadata. All remain eligible and are searched with bounded
concurrency. Evidence is merged under global result caps and trust order:

```text
human-approved OKF
-> automation-approved OKF
-> legacy approved OKF
-> labeled raw RAG
```

Raw RAG trust is constant. Retrieval score never upgrades a raw chunk into
approved evidence. What varies is whether RAG is invoked:

- strong OKF evidence: do not call RAG;
- partial OKF evidence with a named gap: call RAG narrowly for that gap and
  label it unreviewed supporting context;
- weak or no OKF evidence: use the existing clarification path first, then
  fall back to labeled raw discovery when still unresolved.

Graph traversal remains inside the originating bundle. Exact conflicting
numbers, dates, limits, or identifiers from similarly titled approved
concepts in different bundles produce `cross_bundle_conflict`; answer
generation must present the sources separately instead of selecting a value.

## Bundle Deletion

Deleting a selected bundle removes its selection rows but does not delete the
chat or its messages. If another selected bundle remains, the first remaining
selection becomes primary. If none remain, the session is preserved read-only
and displays `Select a knowledge source to continue`.

Historical citations keep their original bundle identity and lifecycle/deletion
notice. They are not silently reassigned to another knowledge source.

Bundle deletion now tombstones every historical assistant answer whose
persisted citations identify the deleted bundle. Mixed-source answers are
tombstoned as a whole, citations and retrieval trace details are cleared, and
knowledge gaps attached to the removed answer are deleted. Legacy citations
without a bundle identity use the exact single-bundle turn snapshot only; an
uncited message is never tombstoned merely because the bundle was selected.
The operation is part of the retryable deletion transaction, so repeated
worker execution is idempotent.

## Approved Next Step: Bounded Adaptive Retry

Production should not move directly from deterministic retrieval to free
model-directed tool choice. The next production candidate is a narrower
adaptive retrieval capability:

```text
question
-> deterministic route and selected-bundle snapshot
-> deterministic retrieval
-> weak or incomplete evidence?
   -> model may broaden/rephrase the retrieval query once
   -> retry within the same route, trust policy, and selected bundle scope
-> answer generation
-> mandatory deterministic evidence validation
-> deterministic fallback or honest miss if validation fails
```

Rules:

- exactly one adaptive retry per turn;
- no arbitrary tool selection;
- no route changes;
- no unselected bundle search;
- no trust-policy changes;
- deterministic retrieval remains the mandatory fallback;
- promotion is per-bundle, not global;
- promotion requires measured citation-correctness improvement over the
  deterministic route-coverage baseline with no policy violations.

This bounded one-retry adaptive capability is approved to proceed as a
near-term production candidate, subject to its own implementation review and
per-bundle promotion criteria. It is distinct from free model-directed tool
choice.

## Implemented Rollout Controls

Production retrieval now records one deterministic evidence-sufficiency
decision:

- `strong`: qualified OKF is sufficient; raw RAG is not called;
- `partial`: approved evidence is retained and raw RAG may supply labeled
  supporting context for the named gap;
- `weak`: approved knowledge did not cover the question and a bundle-enabled
  retry may run once;
- `none`: no supported evidence exists, so clarification and honest-miss
  behavior remain authoritative.

Multi-bundle OKF routes evaluate approved evidence across the complete selected
scope before invoking raw RAG. This prevents a miss in one selected bundle from
starting discovery when another selected bundle has qualified OKF evidence.
Diagnostic near-miss candidates remain a separate non-citation type and cannot
enter answer generation or validation.

The active bundle profile contains:

```ts
agent: {
  boundedAdaptiveRetryEnabled: boolean; // default false
}
```

An eligible retry makes one structured provider call, preserves the route and
graph-traversal decision, preserves protected identifiers, cannot name or add a
bundle/workspace scope, and rejects empty or equivalent rewrites. The retry
uses the same deterministic retrieval implementation only for selected bundles
whose active profiles enable the feature. Original qualified evidence is
retained, merged evidence obeys the existing global caps and trust order, and a
validation failure restores the original deterministic result. Missing keys,
provider errors, malformed output, policy rejection, and no improvement all
fail open to deterministic behavior and are trace-visible.

Rollout status:

- Phase 1 safety blocker: implemented and verified in the rebuilt Docker
  bundle-deletion profile.
- Phase 2 deterministic route baseline: current 21-scenario Docker profile
  passes with zero failures; additional running-stack failure-injection and
  multi-bundle mutation probes remain promotion gates.
- Phase 3 evidence sufficiency: implemented and persisted in assistant traces.
- Phase 4 bounded adaptive retry: implemented behind the default-off bundle
  profile flag.
- Phase 5 evaluation and pilot: not complete. The 30-question comparison,
  seven-day/50-turn pilot, Relation Discovery V3 precision run, and
  five-reviewer trust study are operational gates and cannot be inferred from
  unit coverage.

## Production-Ready Agent Gate

Before the agent workflow can be called production-ready, complete these
prioritized scenarios:

1. Completed safety prerequisite: bundle-deletion citation tombstoning removes
   stale evidence cards, links, citations, and retrieval details while
   preserving eligible chat history.
2. P1: failure injection against the running stack for provider outage, budget
   exhaustion mid-turn, malformed provider output, and partial retrieval
   failure. The expected result is no crash, no invented citations, useful
   fallback or honest miss, and trace-visible failure state.
3. P1: concurrent scope changes during an in-flight message. The in-flight
   answer must use its captured bundle snapshot; later turns use the new
   scope, with no unselected-bundle leakage.
4. P1: cross-bundle conflicting approved values. The answer must disclose the
   conflict and present sources separately rather than silently choosing one.
5. P2: real non-technical user trust review. Automated route coverage cannot
   prove whether users understand OKF vs RAG, human vs automation approval,
   graph-supported answers, drilldown, insufficient evidence, or bundle scope.
   Run at least three to five genuinely non-technical reviewer sessions. Any
   trust criterion failed by more than one reviewer is a real UI/product issue,
   not an outlier.

## Agent Decision Framework

1a. Production authority stays deterministic. The bounded one-retry adaptive
    capability may broaden or rephrase within the selected bundle scope, make
    one attempt, and pass through the existing deterministic evidence validator.
    It is approved to proceed as scoped work, subject to per-bundle promotion
    criteria.
1b. Free model-directed tool choice remains evaluation-only indefinitely until
    it proves measured citation-correctness improvement across the full
    route-coverage suite with zero policy violations.
2. RAG is not more or less trusted based on score. RAG remains unreviewed.
   Improve the evidence-sufficiency classifier so RAG is invoked at the right
   time.
3. Relation discovery remains cautious. Keep deterministic generation plus
   one-pair LLM verification. Do not add semantic expansion until evaluation
   proves recall, not precision, is the limiting problem.
4. Evaluation gates everything. Do not expand agent autonomy, semantic
   relation discovery, or RAG behavior until route coverage, relation
   evaluation, failure injection, bundle-deletion tombstoning, and real user
   trust review are actually run.

## Deferred

- production model-directed tool selection;
- autonomous or mutating agent loops;
- cross-bundle typed relations;
- semantic conflict arbitration;
- automatic bundle selection;
- searching an unselected bundle to decide whether to suggest it.

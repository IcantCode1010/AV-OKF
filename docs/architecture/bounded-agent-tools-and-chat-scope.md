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

The model-directed runner is evaluation-only. Enabling it for production
requires a separate reviewed decision and a successful comparison against the
route-coverage baseline.

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

## Deferred

- production model-directed tool selection;
- autonomous or mutating agent loops;
- cross-bundle typed relations;
- semantic conflict arbitration;
- automatic bundle selection;
- searching an unselected bundle to decide whether to suggest it.

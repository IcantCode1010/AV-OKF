# Knowledge Lifecycle Management

## Purpose

Stage 6.6 defines what happens when knowledge is removed, retracted, archived, restored, or superseded.

AV-OKF is a chain of derived data:

```text
Document -> extracted pages -> topic records -> OKF files -> RAG chunks -> coverage links -> chat citations
```

Deletion cannot be treated as a single database operation. A source document, an approved OKF concept, a RAG chunk, and a historical chat citation have different trust and audit responsibilities.

This document is design first. No deletion implementation should proceed until these policies are reviewed.

## Current State

The current production schema uses `onDelete: Cascade` from `Document` to several dependent records, including document objects, extraction jobs, extracted pages, extraction logs, RAG index jobs, RAG chunks, and topic records. That database behavior is convenient, but it is not sufficient as product policy because it can remove audit-bearing records and trusted evidence without an explicit lifecycle decision.

RAG chunks already have an `isActive` flag. That pattern is appropriate for search projections, but not enough for approved OKF knowledge. RAG chunks and embeddings are derived indexes; OKF files and approved topic records are reviewed knowledge artifacts.

The live OKF bundle retriever reads Markdown files from the active `knowledge/` root and currently treats `review_status: approved` as the trust gate. Stage 6.6 adds lifecycle state as a second trust gate. A file should not be trusted merely because it exists and says `approved`.

Chat citations are persisted with chat messages. Historical chat messages must not be rewritten after a source lifecycle change, but they should be annotated when their cited source is later retracted or archived.

Stage 6.6 remains single-bundle only. Bundle-level states such as `retired`, `archived`, or `deleted` are deferred until multi-bundle support exists.

## Lifecycle Vocabulary

`active` means the record or file is current and available for normal use.

`deleted` means the app hides the record from normal workflows. For audit-bearing objects this is a soft-delete state, not immediate physical removal.

`retracted` means reviewed knowledge is known wrong, unsafe, or no longer valid. Retracted OKF concepts are excluded from trusted agent retrieval.

`archived` means reviewed knowledge is retained for history or audit but is not current. Archived OKF concepts are also excluded from normal trusted agent retrieval. The distinction is: retracted means invalid; archived means historical.

Supersession is not an independent lifecycle source of truth. It derives from the existing typed relation vocabulary: a current source file with `relation: supersedes` points to the stale target. The target should be treated as stale unless the user explicitly asks for historical material.

## Policy Matrix

| Layer | Delete behavior | Restore behavior | Agent trust behavior |
| --- | --- | --- | --- |
| Document | Soft-delete by default. Block deletion if approved/exported OKF concepts depend on it. | Restore metadata if dependencies are consistent. Source object must still exist or document must return to re-extraction-needed state. | Deleted documents cannot produce new trusted evidence. |
| Uploaded object | Retain while approved OKF depends on it. Physical deletion only after trusted dependencies are resolved. | Restore only if object still exists in storage. | Missing source object lowers trust and should surface as source-unavailable. |
| Extracted pages | May be removed with a deleted document after approved OKF dependencies are resolved. | Restore if retained; otherwise re-extraction is required. | Extracted pages are source support, not approved knowledge. |
| Topic record | Draft/unapproved topics may be deleted or rejected. Approved topics are not silently deleted. | Restored topics keep their explicit review/lifecycle state; trust is not silently restored. | Only active approved topics may export trusted OKF. |
| OKF file | Active OKF files can be retracted or archived through a reviewed lifecycle action. Do not silently remove approved files. | Not silently reactivated. Reviewer must re-export or mark current after review. | Active approved only. Retracted, archived, and superseded targets are not trusted by default. |
| RAG chunk and embedding | May be hard-deleted or rebuilt because they are derived search projections. | Not restored automatically; reindex required. | Raw RAG remains discovery/supporting evidence only. |
| Coverage link | Explicitly delete or mark stale when either side is removed. Do not rely on accidental FK behavior. | Recompute from OKF frontmatter through explicit reconciliation. | Coverage projections help validation but do not override OKF frontmatter. |
| Chat citation | Historical messages are not rewritten. | Not applicable. | Show lifecycle notice if cited source is later retracted or archived. |

## Document Deletion

Source documents use soft-delete.

Deleting a document is blocked when any approved or exported OKF concept traces back to it. The reviewer must first retract the approved concept, archive it, or create a current concept that supersedes it.

If no approved OKF concept depends on the document, deletion may proceed by:

1. marking the document deleted,
2. hiding it from normal document lists and retrieval,
3. removing or deactivating raw RAG chunks and embeddings,
4. preserving audit events where practical,
5. retaining storage objects until the deletion retention policy allows physical removal.

This policy intentionally replaces accidental database cascades with explicit product behavior.

## Topic And OKF Concept Lifecycle

Draft or unapproved topic records may be deleted or rejected.

Approved topics are locked. If an approved topic has exported an OKF file, changing its trust state must create a lifecycle event with:

- actor id,
- timestamp,
- reason text,
- topic id,
- OKF filename when available,
- append-only `log.md` entry.

Retraction requires at least the same rigor as approval. For MVP, any authenticated workspace member who can approve and export topics may request retraction, archive, or supersession. The design reserves a future reviewer/admin role but does not require a new role system in Stage 6.6.

Archived and retracted OKF files remain visible in historical/audit views, but not trusted retrieval. If a file is superseded, that status is derived from a `supersedes` typed relation in the current file, not from a separate independent lifecycle flag.

## Coverage Links

OKF frontmatter remains the source of truth for coverage fields. `OkfConceptChunkLink` rows are a database projection for lookup and validation.

Coverage-link reconciliation needs its own explicit trigger or reconciliation path. It must not be hidden inside the RAG reindex flow because RAG reindexing rebuilds raw-search chunks, while coverage reconciliation re-reads approved OKF frontmatter and refreshes derived coverage projections.

When raw RAG chunks are deleted or rebuilt, coverage projections pointing at missing chunks must be deleted or marked stale intentionally. The preferred MVP behavior is to delete stale projection rows and recompute them from OKF frontmatter during explicit reconciliation.

## Relations And Live Retrieval

The live OKF bundle retriever must degrade safely if a relation target disappears after CI passed.

Runtime behavior:

1. Keep the source concept usable if its own frontmatter is valid, active, and approved.
2. Skip the broken relation for relation expansion.
3. Record a warning in retrieval trace/debug output for Stage 7 validation.
4. Do not crash chat.

The relation linter still catches broken targets in CI, but runtime safety is required because the bundle is read live from disk on every query.

## Chat Citation History

Past chat messages are historical records. They are not rewritten when a cited source later changes lifecycle state.

When a user reopens a prior chat, citations should remain visible. If a cited OKF source is now retracted or archived, the UI should annotate it:

```text
This source was retracted after this answer was generated.
```

or:

```text
This source is now archived and may no longer reflect current approved knowledge.
```

Future validation treats those citations as historical evidence only, not current authority.

## Restore Rules

Soft-delete enables restore, but restore is not a blanket trust reset.

Document restore:

- restores document metadata,
- restores references to the uploaded object only if the object still exists,
- keeps extraction records if retained,
- requires re-extraction if extracted pages were removed,
- requires RAG reindex because chunks and embeddings are derived,
- does not silently reactivate retracted or archived OKF files.

Topic restore:

- restores the topic record if it was soft-deleted,
- preserves its lifecycle/review state,
- does not silently mark it trusted.

OKF restore:

- requires reviewer action,
- should re-export or explicitly mark the concept current,
- must append `log.md`.

## Agent And Validation Rules

Current trusted retrieval includes only active approved OKF concepts.

Normal agent answers exclude:

- deleted sources,
- retracted OKF files,
- archived OKF files,
- superseded targets,
- malformed OKF files,
- OKF files whose source document dependency is unresolved.

Historical retrieval may include archived or superseded material only when the user explicitly asks for historical information.

The Validation Agent should treat lifecycle state as part of source authority. A claim supported only by retracted, archived, missing, or superseded evidence should be blocked, rewritten with limitations, or labeled historical according to risk.

## Implementation Staging

Stage 6.6A: design doc only.

Stage 6.6B: add schema/projection fields and read-path lifecycle filtering.

Stage 6.6C: add document and topic lifecycle actions.

Stage 6.6D: add OKF retraction, archive, and supersession workflows.

Stage 6.6E: add relation, restore, chat-citation, coverage-reconciliation, and race-condition tests.

Coverage-link reconciliation is a separate explicit path, not part of RAG reindex.

## Required Tests

Future implementation slices must include:

- document deletion blocked when approved/exported OKF concepts depend on it,
- document deletion succeeds for documents with no approved OKF concepts,
- retraction requires reason, actor, timestamp, and lifecycle log entry,
- archived and retracted OKF files excluded from trusted chat retrieval,
- supersession derived from `supersedes` relations,
- broken relation targets during live retrieval do not crash chat,
- coverage projections cleaned or marked stale intentionally,
- restore test for document metadata, source object availability, RAG reindex requirement, and OKF trust not silently restored,
- past chat citation shows retraction/archive notice after cited source lifecycle changes.

Regression commands:

```bash
pnpm --dir apps/web test
pnpm --dir apps/web lint
pnpm --dir apps/web build
python tools/okf_relation_lint.py --manifest okf-base.yaml
```

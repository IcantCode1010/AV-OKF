# Knowledge Lifecycle Management

## Purpose

Stage 6.6 defines what happens when knowledge is removed, retracted, archived, restored, or superseded.

AV-OKF is a chain of derived data:

```text
Document -> extracted pages -> topic records -> OKF files -> RAG chunks -> coverage links -> chat citations
```

Deletion has one product rule for source documents: deleting a source document soft-deletes the source record, hides it from normal document views, and deactivates raw document RAG. Exported OKF files are not removed automatically. They are managed separately from the Knowledge Bundle page through explicit lifecycle states such as `deleted`, `retracted`, or `archived`.

This document records the current Stage 6.6 product policy and implementation boundaries.

## Current State

The current production schema uses `onDelete: Cascade` from `Document` to dependent records including document objects, extraction jobs, extracted pages, extraction logs, RAG index jobs, RAG chunks, and topic records. Stage 6.6 does not use that cascade for normal source-document deletion. Instead, source-document deletion updates the document with `deletedAt`, `deletedBy`, and `deleteReason`, hides it from production reads, and deactivates its `raw_extraction` RAG chunks. This keeps a reversible source-document tombstone while preventing deleted raw source material from answering chat queries.

RAG chunks already have an `isActive` flag. That pattern is appropriate for search projections, but not enough for approved OKF knowledge. RAG chunks and embeddings are derived indexes; OKF files and approved topic records are reviewed knowledge artifacts.

The live OKF bundle retriever reads Markdown files from the active `knowledge/` root and currently treats `review_status: approved` as the trust gate. Stage 6.6 adds lifecycle state as a second trust gate. A file should not be trusted merely because it exists and says `approved`.

Chat citations are persisted with chat messages. Historical chat messages must not be rewritten after a source lifecycle change, but they should be annotated when their cited source is later retracted or archived.

Stage 6.6 remains single-bundle only. Bundle-level states such as `retired`, `archived`, or `deleted` are deferred until multi-bundle support exists.

## Lifecycle Vocabulary

`active` means the record or file is current and available for normal use.

`deleted` means an OKF bundle file has been explicitly marked unavailable for trusted retrieval through lifecycle state. For source documents, deletion means a soft-deleted document tombstone with raw RAG deactivated.

`retracted` means reviewed knowledge is known wrong, unsafe, or no longer valid. Retracted OKF concepts are excluded from trusted agent retrieval.

`archived` means reviewed knowledge is retained for history or audit but is not current. Archived OKF concepts are also excluded from normal trusted agent retrieval. The distinction is: retracted means invalid; archived means historical.

Supersession is not an independent lifecycle source of truth. It derives from the existing typed relation vocabulary: a current source file with `relation: supersedes` points to the stale target. The target should be treated as stale unless the user explicitly asks for historical material.

## Policy Matrix

| Layer | Delete behavior | Restore behavior | Agent trust behavior |
| --- | --- | --- | --- |
| Document | Soft-delete the `Document` row with `deletedAt`, `deletedBy`, and `deleteReason`. No block for approved/exported OKF. | Restore is possible at the database/application layer by clearing delete metadata. | Soft-deleted documents are hidden from normal reads and cannot produce raw evidence. |
| Uploaded object | Retained while the soft-deleted document tombstone exists. Physical cleanup is deferred to a later storage lifecycle policy. | Available again if the document is restored and the object still exists. | Source object is not surfaced from normal deleted-document paths. |
| Extracted pages | Retained with the soft-deleted document unless a future cleanup job removes them. | Available again if the document is restored. | Extracted pages are source support, not approved knowledge. |
| Topic record | Retained with the soft-deleted document. | Available again if the document is restored. | Topics on a soft-deleted document should not drive normal review/export workflows. |
| OKF file | Left on disk. It remains visible in Knowledge for audit/curation and can be marked `deleted`, `retracted`, or `archived` explicitly. | Lifecycle state can be changed by a future restore/reactivation workflow. | Trusted retrieval excludes files whose lifecycle status is not `active`. |
| RAG chunk and embedding | `raw_extraction` chunks are deactivated with `isActive: false`; OKF-derived chunks are left alone. | Reindex or explicit reactivation required after restore. | Raw RAG remains discovery/supporting evidence only and inactive chunks are not retrieved. |
| Coverage link | Deleted by database cascade through the explicit `OkfConceptChunkLink.chunkId -> RagChunk.id` foreign key when linked chunks are deleted. | Recompute from OKF frontmatter through explicit reconciliation. | Coverage projections help validation but do not override OKF frontmatter. |
| Chat citation | Historical chat messages are not rewritten; citation JSON remains on the message. | Not applicable. | Historical citations may point to removed sources and should render without crashing, but are not current authority. |

## Document Deletion

Source-document deletion is a soft delete.

When a user deletes a source document, the app:

1. requires a reason,
2. writes `deletedAt`, `deletedBy`, and `deleteReason` on the document,
3. deactivates active `raw_extraction` RAG chunks for that document,
4. writes an activity event noting the soft-delete.

No OKF lifecycle retraction is written automatically for this path. Retraction, archive, and bundle-file deletion remain explicit reviewer trust actions. Source-document deletion means the raw source is hidden and raw RAG is disabled; it does not silently remove or demote exported OKF knowledge.

This policy intentionally has no approved-OKF blocking gate. Deleted source documents can coexist with exported OKF files, but those OKF files must be managed from the Knowledge Bundle page when the reviewer wants them excluded from trusted retrieval.

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

Source-document deletion is restorable in principle because the document row remains as a tombstone. Restoring a document must be explicit: clear delete metadata, decide whether extracted pages/topics are still valid, and reindex or reactivate raw RAG intentionally. OKF files are not automatically reactivated by source-document restore because their lifecycle state is managed separately.

Reviewer-driven OKF lifecycle states such as `archived` or `retracted` may have future restore/reactivation workflows, but source-document deletion does not create those lifecycle states.

## Agent And Validation Rules

Current trusted retrieval includes only existing active approved OKF concepts. Soft-deleted source documents do not contribute active raw RAG evidence, but exported OKF files remain eligible until their own lifecycle state changes.

Normal agent answers exclude:

- inactive raw RAG from soft-deleted source documents,
- deleted or missing OKF products,
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

Stage 6.6C: add soft-delete document action, raw RAG deactivation, and explicit bundle-file lifecycle controls.

Stage 6.6D: add OKF retraction, archive, and supersession workflows.

Stage 6.6E: add relation, restore, chat-citation, coverage-reconciliation, and race-condition tests.

Coverage-link reconciliation is a separate explicit path, not part of RAG reindex.

## Required Tests

Future implementation slices must include:

- document soft-delete succeeds even when approved/exported OKF concepts depend on it,
- document soft-delete writes `deletedAt`, `deletedBy`, and `deleteReason`,
- document soft-delete deactivates `raw_extraction` RAG chunks but leaves OKF-derived chunks and bundle files untouched,
- Knowledge Bundle file deletion marks selected files lifecycle `deleted` and excludes them from trusted retrieval,
- historical chat messages with citation JSON still render after the cited document is deleted,
- retraction requires reason, actor, timestamp, and lifecycle log entry,
- archived and retracted OKF files excluded from trusted chat retrieval,
- supersession derived from `supersedes` relations,
- broken relation targets during live retrieval do not crash chat,
- coverage projections cleaned or marked stale intentionally,
- restore requires an explicit application/database action and raw RAG reindex or reactivation,
- past chat citation remains visible after cited source deletion.

Regression commands:

```bash
pnpm --dir apps/web test
pnpm --dir apps/web lint
pnpm --dir apps/web build
python tools/okf_relation_lint.py --manifest okf-base.yaml
```

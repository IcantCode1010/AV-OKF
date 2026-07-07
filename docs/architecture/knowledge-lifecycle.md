# Knowledge Lifecycle Management

## Purpose

Stage 6.6 defines what happens when knowledge is removed, retracted, archived, restored, or superseded.

AV-OKF is a chain of derived data:

```text
Document -> extracted pages -> topic records -> OKF files -> RAG chunks -> coverage links -> chat citations
```

Deletion has one product rule for source documents: deleting a source document hard-deletes that document and all derived products. A standalone OKF concept lifecycle event such as retraction or archive is reserved for reviewer-driven trust changes, not source-document deletion.

This document records the current Stage 6.6 product policy and implementation boundaries.

## Current State

The current production schema uses `onDelete: Cascade` from `Document` to dependent records including document objects, extraction jobs, extracted pages, extraction logs, RAG index jobs, RAG chunks, and topic records. Stage 6.6 now intentionally uses that cascade for source-document deletion. The app cleans filesystem OKF bundle artifacts first, writes a minimal append-only audit line to `log.md`, then deletes the `Document` row so database-owned derived rows are removed by FK cascade.

RAG chunks already have an `isActive` flag. That pattern is appropriate for search projections, but not enough for approved OKF knowledge. RAG chunks and embeddings are derived indexes; OKF files and approved topic records are reviewed knowledge artifacts.

The live OKF bundle retriever reads Markdown files from the active `knowledge/` root and currently treats `review_status: approved` as the trust gate. Stage 6.6 adds lifecycle state as a second trust gate. A file should not be trusted merely because it exists and says `approved`.

Chat citations are persisted with chat messages. Historical chat messages must not be rewritten after a source lifecycle change, but they should be annotated when their cited source is later retracted or archived.

Stage 6.6 remains single-bundle only. Bundle-level states such as `retired`, `archived`, or `deleted` are deferred until multi-bundle support exists.

## Lifecycle Vocabulary

`active` means the record or file is current and available for normal use.

`deleted` means the source document and its derived database products have been physically removed. Stage 6.6 no longer keeps a source-document tombstone row.

`retracted` means reviewed knowledge is known wrong, unsafe, or no longer valid. Retracted OKF concepts are excluded from trusted agent retrieval.

`archived` means reviewed knowledge is retained for history or audit but is not current. Archived OKF concepts are also excluded from normal trusted agent retrieval. The distinction is: retracted means invalid; archived means historical.

Supersession is not an independent lifecycle source of truth. It derives from the existing typed relation vocabulary: a current source file with `relation: supersedes` points to the stale target. The target should be treated as stale unless the user explicitly asks for historical material.

## Policy Matrix

| Layer | Delete behavior | Restore behavior | Agent trust behavior |
| --- | --- | --- | --- |
| Document | Hard-delete the `Document` row. No block for approved/exported OKF. | No automatic restore. Re-upload/re-ingest is required. | Deleted documents cannot produce new evidence. |
| Uploaded object | Deleted by database cascade from `DocumentObject`; physical object-store cleanup remains a storage-adapter responsibility. | No automatic restore. | Missing source object is not trusted evidence. |
| Extracted pages | Deleted by database cascade. | Re-extraction required after re-upload. | Extracted pages are source support, not approved knowledge. |
| Topic record | Deleted by database cascade regardless of review status. | No automatic restore. | Deleted topics cannot export or serve trusted OKF. |
| OKF file | Derived exported files for every topic from the document are removed from `knowledge/`; `index.md` and `source_manifest.md` references are removed. | Re-export after re-upload/re-review. | Removed files are unavailable to the live OKF retriever. |
| RAG chunk and embedding | Hard-deleted by database cascade because they are derived search projections. | Reindex required after re-upload. | Raw RAG remains discovery/supporting evidence only. |
| Coverage link | Deleted by database cascade through the explicit `OkfConceptChunkLink.chunkId -> RagChunk.id` foreign key when linked chunks are deleted. | Recompute from OKF frontmatter through explicit reconciliation. | Coverage projections help validation but do not override OKF frontmatter. |
| Chat citation | Historical chat messages are not rewritten; citation JSON remains on the message. | Not applicable. | Historical citations may point to removed sources and should render without crashing, but are not current authority. |

## Document Deletion

Source-document deletion is a hard delete.

When a user deletes a source document, the app:

1. loads every topic for that document, regardless of review status,
2. derives and removes every exported OKF topic file for those topics from the active `knowledge/` root,
3. removes those filenames from `knowledge/index.md`,
4. removes the source document entry from `knowledge/source_manifest.md`,
5. appends one minimal audit line to `knowledge/log.md` with actor, timestamp, source title, reason, and concept count removed,
6. deletes the `Document` row,
7. relies on `onDelete: Cascade` to remove document-owned database products: objects, extracted pages, extraction logs/jobs, topics, RAG jobs, RAG chunks, embeddings through chunks, and dependent coverage projections through `RagChunk` deletion.

No OKF lifecycle retraction is written for this path. Retraction and archive remain reviewer trust actions. Source-document deletion means the derived product is gone, not demoted.

This policy intentionally has no approved-OKF blocking gate. Deleted source means all derived OKF and RAG products are removed regardless of review status.

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

Source-document deletion is not restorable in place. To restore removed knowledge, the user must re-upload the source document, re-run extraction/RAG indexing, regenerate/review topics, and re-export OKF.

Reviewer-driven OKF lifecycle states such as `archived` or `retracted` may have future restore/reactivation workflows, but source-document deletion does not create those lifecycle states.

## Agent And Validation Rules

Current trusted retrieval includes only existing active approved OKF concepts. Deleted source-document products are removed from the live bundle and cannot be retrieved.

Normal agent answers exclude:

- deleted or missing source products,
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

Stage 6.6C: add hard-delete document action and topic/OKF cleanup.

Stage 6.6D: add OKF retraction, archive, and supersession workflows.

Stage 6.6E: add relation, restore, chat-citation, coverage-reconciliation, and race-condition tests.

Coverage-link reconciliation is a separate explicit path, not part of RAG reindex.

## Required Tests

Future implementation slices must include:

- document hard-delete succeeds even when approved/exported OKF concepts depend on it,
- document hard-delete cascades document objects, extracted pages, extraction jobs/logs, topic records, RAG chunks/embeddings, and coverage projections,
- exported OKF Markdown files and `index.md` / `source_manifest.md` references are removed for approved, needs-review, and rejected topics,
- historical chat messages with citation JSON still render after the cited document is deleted,
- retraction requires reason, actor, timestamp, and lifecycle log entry,
- archived and retracted OKF files excluded from trusted chat retrieval,
- supersession derived from `supersedes` relations,
- broken relation targets during live retrieval do not crash chat,
- coverage projections cleaned or marked stale intentionally,
- no in-place restore for hard-deleted source documents; re-upload is required,
- past chat citation remains visible after cited source deletion.

Regression commands:

```bash
pnpm --dir apps/web test
pnpm --dir apps/web lint
pnpm --dir apps/web build
python tools/okf_relation_lint.py --manifest okf-base.yaml
```

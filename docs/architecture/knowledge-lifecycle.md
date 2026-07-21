# Knowledge Lifecycle Management

## Purpose

AV-OKF produces a chain of derived data:

```text
Document -> extracted pages -> topics -> OKF concepts -> RAG -> chat citations
```

Source-document deletion is permanent. It removes the source and every product derived from it instead of retaining a restorable tombstone. Retraction and archive remain separate reviewer actions for OKF concepts whose source document is retained.

## Document Deletion Policy

Only workspace admins may request permanent deletion. The UI asks one clear confirmation and does not require typed text or a reason.

Confirmation immediately marks the document unavailable, deactivates its RAG chunks, and quarantines its exported concepts with a temporary `deleting` lifecycle projection. A durable BullMQ worker then retries cleanup across PostgreSQL, MinIO, and the bundle filesystem until all three agree.

Approved concepts do not block source deletion. There is no grace period, trash, undo, or restore workflow.

## Cleanup Matrix

| Layer | Permanent deletion behavior |
| --- | --- |
| Document | Hard-delete after external cleanup completes. Direct relational dependents use verified database cascades. |
| Uploaded object | Delete every recorded source object from MinIO. Missing objects are idempotent success. |
| Extraction and authoring | Delete extracted pages, logs, jobs, proposals, audits, topics, enrichment history, and bulk items. Workers stop when the document is deleting or missing. |
| OKF bundle | Delete every exported topic file, remove index/source-manifest/export-log references, and prune incoming relations from surviving concepts. |
| RAG and coverage | Delete raw and OKF-derived chunks, embeddings, index jobs, and concept coverage projections. |
| OKF lookup projections | Delete concept embeddings, embedding jobs, lifecycle projections, and relation candidates for removed files. Re-embed surviving files whose relations changed. |
| Activity | Delete document activity events. |
| Chat | Tombstone any assistant answer citing the raw document or a deleted exported concept, including mixed-source answers. Clear citations and trace. User messages remain. |

## Durable Job And Failure Behavior

`DocumentDeletionJob` is temporary operational state with a unique `documentId` claim and no foreign key back to `Document`. Its manifest snapshots object keys, topic IDs, and exported file paths so retries remain possible after partial external cleanup or final row deletion.

Queued and running jobs reconcile on worker startup. A failed job remains visible to workspace admins with a retry action. A successful job is removed from PostgreSQL and BullMQ after the final bundle log entry is written.

Deletion paths use the shared realpath boundary guard. Missing files and objects are treated as already removed; path traversal or symlink escape fails the job without touching anything outside the bundle.

## Relations And Reserved Files

`TopicRecord.exportedFilePath` is the primary source-to-file mapping. Legacy records use the stable SHA-256 topic-ID fragment in generated filenames.

Deletion removes exact links from `index.md`, removes the source-manifest entry only when no surviving exported document with the same title needs it, and removes obsolete export/re-export log lines. Typed relations targeting deleted concepts are pruned from surviving topic drafts and frontmatter. Relation changes update `updated` and queue replacement semantic embeddings.

## Chat History

An assistant answer with any deleted-document citation is replaced with:

```text
This answer was removed because its supporting source was permanently deleted.
```

Its citations and trace are cleared. The whole answer is tombstoned when evidence was mixed because individual claims cannot be safely separated after deletion. Unrelated messages and user-authored questions remain.

## Minimal Deletion Record

Successful deletion appends one automatic `log.md` entry containing the timestamp, document title, and counts of source objects, topics, concept files, RAG chunks, and tombstoned assistant answers. No user reason or source content is retained.

## Independent OKF Lifecycle

`retracted` means reviewed knowledge is known invalid. `archived` means it is historical and no longer current. Both remain excluded from normal trusted retrieval. Supersession continues to derive from the typed `supersedes` relation rather than an independent lifecycle flag.

These concept-level workflows apply when the source document remains. Permanent source-document deletion removes the concept instead.

## Required Verification

- concurrent requests create one deletion job;
- access and retrieval stop immediately;
- running workers cannot recreate deleted data;
- PostgreSQL cascades remove all direct dependents;
- MinIO and bundle files are removed idempotently;
- reserved files, path projections, and incoming relations are cleaned;
- raw, OKF, and mixed-source answers are tombstoned;
- failures remain retryable and successful jobs disappear;
- the final minimal log counts are stable across retries;
- Docker restart does not restore deleted content.

# File Processing Walkthrough E2E - 2026-07-02

## Purpose

Run the end-user file processing walkthrough against the local Docker/VPS stack and document the UI flow, backend activity, errors, fixes, and final completed result.

## Environment

- App URL: `http://localhost:3000`
- Stack: Docker Compose production data plane
- Services involved: `web`, `worker`, `postgres`, `redis`, `minio`, `caddy`, `knowledge-init`
- Browser user: `test@av-okf.local`
- Test document: `737 qrh`
- Document ID: `doc_54809dbb-8947-4114-a517-2416a5b5adf9`
- Approved topic ID: `cmr3wkscb000301qsvla1j88x`
- Walkthrough start time: `2026-07-02T15:33:16-04:00`

## Scope Note

The walkthrough document starts with uploading a new PDF. The in-app browser automation surface used for this run does not expose a reliable file-picker upload operation, so this run used an existing real uploaded PDF and verified its stored object and activity records instead of creating a fresh browser upload.

The rest of the flow was executed through the browser:

```text
Open document
-> verify extraction
-> complete OKF metadata
-> generate topic records
-> approve one topic
-> export OKF
-> validate bundle
-> reindex RAG
-> search
-> verify knowledge preview
```

## Baseline State

Before the user-flow actions, the document was already uploaded and extracted:

```text
document: 737 qrh
status: ready
pages: 402
extracted_pages: 402
topics: 0
rag_status: index_failed
active_rag_chunks: 0
OKF metadata: missing
```

Stored object record:

```text
kind: original_pdf
bucket: av-okf
content_type: application/pdf
size_bytes: 2189559
object_key: workspaces/cmr2lf3s0000101suuz8cz5mn/documents/doc_54809dbb-8947-4114-a517-2416a5b5adf9/original/a7187e61-f90d-4408-9693-ba2abd6adb65.pdf
```

Activity records confirmed the earlier upload and extraction lifecycle:

```text
PDF uploaded
Extraction queued
Extraction started
Extraction completed
```

## User Flow Executed

### 1. Open Document Library And Document Detail

Opened `/documents`, selected `737 qrh`, and verified the document detail page loaded without the `Something went wrong` error boundary.

Result:

```text
pass
```

### 2. Verify Extraction

On the document detail page, extraction showed completed state and page records.

Database evidence:

```text
pages: 402
extracted_pages: 402
status: ready
```

Result:

```text
pass
```

### 3. Complete OKF Metadata

Filled and saved the required export metadata:

```text
aircraft_family: Boeing 737NG
manual_type: QRH
ata: 00
effectivity: 737NG fleet
source_authority: Operator training reference
revision: Walkthrough validation 2026-07-02
description: End-user walkthrough validation document for AV-OKF processing flow.
```

Database confirmed all fields persisted.

Result:

```text
pass
```

### 4. Generate Topic Records

Clicked `Generate topics` from the document detail page.

Database result:

```text
topics_created: 368
needs_review: 368
```

Result:

```text
pass
```

### 5. Approve One Topic

Approved the first generated topic:

```text
topic: Quick Action Index
topic_id: cmr3wkscb000301qsvla1j88x
review_status: approved
page_range: 1-1
confidence: high
```

Database result:

```text
approved_topics: 1
needs_review: 367
```

Result:

```text
pass
```

### 6. Export Approved Topic To OKF

Clicked `Export OKF` for the approved topic.

First attempt failed:

```text
EACCES: permission denied, open '/data/knowledge/00-quick-action-index-9e104e7400.md'
```

Root cause:

```text
knowledge-data volume was root-owned.
web runs as uid=100(nextjs), gid=101(nextjs).
```

Fix applied:

```text
Added a knowledge-init Compose service that chowns knowledge-data to 100:101 before web/worker start.
```

Retried export through the browser. Export succeeded.

Generated files in Docker knowledge volume:

```text
00-quick-action-index-9e104e7400.md
index.md
log.md
source_manifest.md
```

Result after fix:

```text
pass
```

### 7. Validate OKF Bundle

Copied `/data/knowledge` from the Docker web container into a temp validation root and ran validators against the actual generated files.

`okflint`:

```text
✅ All files are OKF-conformant.
```

Typed relation linter:

```json
{
  "status": "pass",
  "violation_count": 0,
  "violations": []
}
```

Note: running `okflint` in the default Windows console encoding hit a `UnicodeEncodeError` when printing the success checkmark. Re-running with `PYTHONIOENCODING=utf-8` produced a clean pass.

Result:

```text
pass
```

### 8. Reindex RAG

The document initially showed:

```text
rag_status: index_failed
error: embedding_budget_exceeded
message: Document requires 423771 embedding tokens, exceeding per-document cap of 250000.
```

For this E2E walkthrough, the Docker runtime cap was temporarily raised:

```text
RAG_EMBEDDING_MAX_TOKENS_PER_DOCUMENT=500000
```

The first retry failed because Docker Compose did not receive the OpenAI key:

```text
missing_env_OPENAI_API_KEY
```

Root cause:

```text
OPENAI_API_KEY was present in apps/web/.env.
Docker Compose reads the root .env by default, so the key was not passed into web/worker.
```

Runtime recovery:

```text
Loaded OPENAI_API_KEY from apps/web/.env into the shell environment.
Recreated web and worker.
Verified both containers saw a non-empty OPENAI_API_KEY.
```

Second issue found:

```text
The worker failed before getEmbeddingProvider() entered runRagIndexJob's try/catch block.
The BullMQ job failed, but the DB job stayed queued.
Reconciliation re-enqueued the DB job, but BullMQ still had the deterministic failed job ID.
```

Fix applied:

```text
Moved embedding provider construction inside runRagIndexJob's failure boundary.
Added regression test: runRagIndexJob marks provider construction failures failed.
```

Recovery step for this run:

```text
Marked the stale pre-fix queued DB job failed with a diagnostic message.
Started a fresh reindex job from /admin/reindex.
```

Final RAG result:

```text
rag_status: indexed
rag_index_version: 1
active_rag_chunks: 277
active_embeddings: 277
latest_index_job_status: completed
token_estimate: 181696
attempts: 1
```

Worker log:

```text
RAG index job completed: rag-index:doc_54809dbb-8947-4114-a517-2416a5b5adf9:cmr3wv98e000001nokmnxssxz
```

Result after runtime config and code fix:

```text
pass
```

### 9. Search The Document

Opened:

```text
/search?q=Airspeed%20Unreliable
```

Browser result included:

```text
document: 737 qrh
review_status: raw
pages: 171-174
matching text included airspeed-related content
```

Result:

```text
pass
```

### 10. Verify Knowledge Preview

Opened `/knowledge`.

Visible bundle files:

```text
00-quick-action-index-9e104e7400.md
index.md
log.md
source_manifest.md
```

The preview rendered the exported `Quick Action Index` system topic with approved frontmatter.

Result:

```text
pass
```

## Backend Logs Of Interest

Expected/service logs:

```text
web ready on port 3000
test_auth_enabled_in_production warning for local smoke auth
Node url.parse deprecation warning from auth internals
RAG index job completed: rag-index:doc_54809dbb-8947-4114-a517-2416a5b5adf9:cmr3wv98e000001nokmnxssxz
```

Errors/warnings found:

```text
EACCES writing /data/knowledge/...md
missing_env_OPENAI_API_KEY in worker
embedding_budget_exceeded at 250000-token per-document cap
stale queued RAG DB job after provider construction failed outside try/catch
pg warning: Calling client.query() when the client is already executing a query is deprecated
Windows console UnicodeEncodeError when okflint prints success checkmark without UTF-8 output
```

## Final Completed Result

The document processing workflow completed for `737 qrh`:

```text
stored_pdf: yes
object_storage_record: yes
extracted_pages: 402
topic_records: 368
approved_topics: 1
exported_okf_file: 00-quick-action-index-9e104e7400.md
index_md: generated
log_md: generated
source_manifest_md: generated
okflint_validate: pass
typed_relation_lint: pass
rag_status: indexed
active_rag_chunks: 277
active_embeddings: 277
search_result_returned: yes
knowledge_preview_rendered: yes
```

## Follow-Up Items

1. Document Docker Compose env loading clearly: production Compose reads root `.env`, not `apps/web/.env`.
2. Decide whether the default per-document embedding budget should stay at `250000` or whether large manuals need an admin override workflow.
3. Add a durable queue recovery improvement for deterministic BullMQ job IDs that are already failed in Redis while the DB row is still queued.
4. Investigate the pg deprecation warning around concurrent `client.query()` calls.
5. Consider adding a browser-test-friendly upload path or Playwright E2E harness that can upload files directly.

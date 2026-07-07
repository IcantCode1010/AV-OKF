# End-To-End User Testing Profile

## Purpose

Use this profile to test AV-OKF as an end user, not as a developer. The goal is to prove that a user can take a source PDF through extraction, topic review, enrichment, OKF export, RAG indexing, knowledge-bundle review, chat retrieval, and lifecycle management without relying on direct database edits.

## Tester Persona

**Role:** Knowledge reviewer / document curator

**Primary job:** Turn uploaded documents into reviewed knowledge that an agent can safely use.

**What the tester should care about:**

- Can I upload and process a PDF without developer help?
- Can I see when extraction, indexing, enrichment, and export are working?
- Can I tell whether chat answers came from approved OKF or raw RAG?
- Can I remove or hide bad source material without breaking the knowledge bundle?
- Can I trust that deleted or lifecycle-marked knowledge stops being used by chat?

## Test Environment

Run against the Docker/VPS-style stack unless the test says otherwise.

```text
App URL: http://localhost:3000
Backend: production Postgres backend
Services: web, worker, postgres, redis, minio, caddy, knowledge-init
Auth: local test auth or configured OAuth
Knowledge root: configured AV_OKF_KNOWLEDGE_ROOT
```

Use a real PDF with selectable text and headings. Aviation manuals are preferred for domain realism, but at least one non-aviation document should also be tested to confirm the platform remains generic.

## Test Data Profile

Use one primary PDF that should complete the full flow:

- Multi-page PDF.
- Clear enough headings for topic generation.
- At least one topic that can reasonably be approved.
- At least one search/chat question that should hit raw RAG.
- At least one search/chat question that should hit approved OKF after export.

Use one negative PDF or invalid file for failure-path testing:

- Malformed PDF, password-protected PDF, or non-PDF renamed with `.pdf`.

## Required User Flows

### Flow 1: Upload And Extraction

1. Open `/documents`.
2. Upload a PDF with title, owner, source type, tags, and description.
3. Confirm the app redirects to the document detail page.
4. Confirm extraction moves through processing and reaches `ready`.
5. Confirm extracted pages and extraction logs are visible.

Pass criteria:

- Upload does not expose raw filenames as storage paths.
- Extraction status is visible.
- Failed extraction shows a readable error and retry path.

### Flow 2: Topic Generation And Manual Review

1. Open the document detail page.
2. Generate topics after extraction completes.
3. Review generated topics.
4. Edit one unapproved topic title and summary.
5. Confirm the edited indicator appears.
6. Approve one topic.
7. Reject one low-quality topic if available.

Pass criteria:

- Original extracted title/summary are preserved separately from edited values.
- Approved topics lock editing.
- Topic source pages are visible.

### Flow 3: LLM Enrichment

1. Open Settings.
2. Configure an LLM provider and API key.
3. Return to an unapproved topic.
4. Run enrichment.
5. Confirm pending/failed/completed state is visible.
6. Compare raw versus enriched content.
7. Approve either raw or enriched content explicitly.

Pass criteria:

- API key is never displayed after save.
- Enrichment result is shown separately from raw content.
- Approval records whether raw or enriched content was selected.

### Flow 4: OKF Export

1. Complete required document metadata:
   - aircraft family
   - manual type
   - ATA
   - effectivity
   - source authority
   - revision
2. Export one approved topic to OKF.
3. Open `/knowledge`.
4. Open the bundle explorer.
5. Confirm the exported topic appears under System topics.
6. Open `index.md`, `source_manifest.md`, and `log.md`.

Pass criteria:

- Export fails clearly when required metadata is missing.
- Exported file appears in the bundle.
- `index.md`, `source_manifest.md`, and `log.md` are updated.
- The exported topic uses the actual persisted `exportedFilePath` for later lifecycle actions.

### Flow 5: RAG Indexing And Search

1. Open `/admin/reindex`.
2. Reindex the test document if needed.
3. Confirm status moves to indexed or failed with a readable error.
4. Open `/search`.
5. Search for text known to exist in the PDF.

Pass criteria:

- Search returns source title, page citation, review status, and source type.
- Raw extraction results are labeled as raw/unreviewed.
- Reindex does not remove OKF bundle files.

### Flow 6: Chat Evidence Cards

Ask at least four questions:

1. A question expected to match approved OKF.
2. A question expected to match raw RAG only.
3. A question expected to use mixed OKF and raw RAG.
4. A question expected to have no supporting evidence.

Pass criteria:

- Assistant response shows a pending indicator before completion.
- Each assistant response shows an inline evidence card.
- Evidence card types render correctly:
  - `APPROVED · OKF`
  - `RAW DOCUMENT`
  - `MIXED SOURCES`
  - `NO EVIDENCE`
- Expanded evidence details show citations and excerpts.
- No answer invents citations.

### Flow 7: Option-2 Lifecycle Deletion

This is the current product decision for Stage 6.6.

1. Soft-delete a source document from the document metadata panel.
2. Confirm the document disappears from normal document lists.
3. Confirm raw RAG chunks from that document no longer answer chat/search.
4. Confirm exported OKF files are still visible in `/knowledge/bundle`.
5. Select an OKF file in the bundle explorer.
6. Enter a reason and mark it deleted.
7. Ask a chat question that previously used that OKF file.

Pass criteria:

- Source document deletion writes reason/actor/timestamp metadata.
- Source document deletion deactivates `raw_extraction` RAG.
- Source document deletion does not automatically remove OKF bundle files.
- Marking an OKF bundle file `deleted` hides it from trusted chat retrieval.
- The bundle explorer shows the lifecycle status.

## Backend Activity To Monitor

During testing, record whether each event occurs:

- Upload object created.
- Extraction job queued, running, completed or failed.
- Extracted page records written.
- Topic records generated.
- Topic edits persisted.
- Enrichment audit row written.
- OKF export file written.
- `index.md`, `source_manifest.md`, and `log.md` updated.
- RAG indexing job completed or failed.
- Chat message trace stores route, retrieval tools, answer mode, and evidence profile.
- Document soft-delete records metadata and deactivates raw RAG.
- OKF lifecycle action records selected file status and reason.

## Failure Scenarios

Run these at least once per release candidate:

- Upload malformed PDF.
- Try OKF export with missing metadata.
- Try enrichment without a provider key.
- Ask chat a question with no indexed evidence.
- Mark an OKF file deleted and confirm chat does not show it as approved evidence.
- Try relation validation with a missing target file.

## Evidence To Capture

For each E2E test run, capture:

- Date and tester.
- Git commit hash.
- Docker image/build version if available.
- Test document title and document id.
- Topic id and exported filename.
- Screenshots or notes for any UI error.
- Backend log snippets for failures.
- Final pass/fail summary.

## Completion Criteria

The end-to-end profile passes when:

- A real PDF reaches `ready`.
- At least one topic is reviewed and exported to OKF.
- The knowledge bundle preview shows the exported file and reserved files.
- Raw RAG search works.
- Chat can distinguish approved OKF, raw RAG, mixed, and no-evidence answers.
- Source-document soft-delete disables raw RAG while preserving OKF bundle files.
- OKF bundle lifecycle deletion removes selected OKF files from trusted chat retrieval.
- No page shows `Something went wrong` during the happy path.


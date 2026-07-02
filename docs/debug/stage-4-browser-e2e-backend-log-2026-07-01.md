# Stage 4 Browser E2E Backend Debug Log - 2026-07-01

## Scope

Browser and backend smoke test for the Stage 4 PDF extraction and RAG indexing path using the local Docker/VPS stack.

## Environment

- App URL: `http://127.0.0.1:3000`
- Auth mode: local test credentials provider
- Test user: `test@av-okf.local`
- Workspace: `cmr2lf3s0000101suuz8cz5mn`
- Stack observed: `web`, `worker`, `postgres`, `redis`, `minio`, `caddy`

## Browser Flow

1. Signed in with local test auth.
2. Opened `/documents`.
3. Confirmed the upload form rendered.
4. Opened document detail pages after backend ingestion.
5. Confirmed extracted page records rendered in the browser.
6. Opened `/search`.
7. Searched indexed content and confirmed results rendered with document title and page citations.

## File Upload Automation Note

The in-app browser wrapper exposes the file input but does not expose Playwright `setInputFiles`. Attempting to `fill()` the file input failed with a selector deadline timeout. Because of that runtime limitation, the PDF object was ingested through the production backend path directly:

- PDF bytes uploaded to MinIO.
- Document and object rows created in Postgres.
- Extraction job row created in Postgres.
- BullMQ extraction job enqueued in Redis.

The browser then verified the authenticated UI, document detail rendering, and search result behavior.

## Test Documents

### Small Extraction/Search Document

- Local source PDF: `output/pdf/av-okf-e2e-test-manual.pdf`
- Document ID: `doc_78d94fae-3305-4307-b817-393da89f62d3`
- Title: `Browser E2E Test Manual 2026-07-01T21:51:19.078Z`
- Object key: `workspaces/cmr2lf3s0000101suuz8cz5mn/documents/doc_78d94fae-3305-4307-b817-393da89f62d3/original/54094a92-4ee9-4a03-821c-56accc0e1e59.pdf`
- Extraction job: `cmr2m1bze00026uqx8pq55vuv`
- RAG index job: `cmr2m1cj400090in0u27bj08j`

Observed backend state:

- Document status: `ready`
- RAG status: `indexed`
- Pages extracted: `5`
- RAG chunks: `1`
- Embeddings: `1`
- Embedding dimensions: `1536`
- MinIO object present: yes, `5.2 KiB`

Browser search:

- Query: `zebra relay calibration marker 4`
- Result: returned the document with citation `Pages 1-5`
- Note: citation is broad because the document was small enough to fit in one RAG chunk.

### Citation Stress Document

- Local source PDF: `output/pdf/av-okf-e2e-citation-manual.pdf`
- Document ID: `doc_ed6471a5-7235-47ff-8c7e-baf3edbf56ed`
- Title: `Browser E2E Citation Manual 2026-07-01T21:54:36.395Z`
- Object key: `workspaces/cmr2lf3s0000101suuz8cz5mn/documents/doc_ed6471a5-7235-47ff-8c7e-baf3edbf56ed/original/c8706abe-0c9c-42b7-99c3-df8da1035759.pdf`
- Extraction job: `cmr2m5k9200029zqxlx4d39ik`
- RAG index job: `cmr2m5kb9000o0in0uxqioo8k`

Observed backend state:

- Document status: `ready`
- RAG status: `indexed`
- Pages extracted: `10`
- RAG chunks: `17`
- Embeddings: `17`
- RAG job token estimate: `17704`
- RAG job attempts: `1`

Browser search:

- Query: `amber torque limiter marker 4`
- Result: returned the citation document with citation `Pages 7-8`
- Expected marker location from PDF extraction: page `8`
- Note: the returned citation includes the correct page, but overlap chunking allowed a `7-8` chunk to rank above the single-page `8` chunk.

## Worker Log Highlights

```text
Extraction job completed: extract:doc_78d94fae-3305-4307-b817-393da89f62d3:cmr2m1bze00026uqx8pq55vuv
RAG index job completed: rag-index:doc_78d94fae-3305-4307-b817-393da89f62d3:cmr2m1cj400090in0u27bj08j
Extraction job completed: extract:doc_ed6471a5-7235-47ff-8c7e-baf3edbf56ed:cmr2m5k9200029zqxlx4d39ik
RAG index job completed: rag-index:doc_ed6471a5-7235-47ff-8c7e-baf3edbf56ed:cmr2m5kb9000o0in0uxqioo8k
```

## Findings

- Backend extraction and RAG indexing completed successfully for both PDFs.
- Postgres persistence, MinIO object storage, Redis/BullMQ job execution, and OpenAI embeddings all worked in the Docker stack.
- Browser login, document detail rendering, and search UI worked without console errors.
- File-picker upload could not be automated with the current in-app browser API because `setInputFiles` is not exposed.
- Citation behavior works, but overlap chunks can produce broader page ranges than the exact page containing the query phrase.


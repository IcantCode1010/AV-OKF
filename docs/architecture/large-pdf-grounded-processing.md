# Large-PDF Grounded Processing

AV-OKF processes PDFs up to 250 MB or 5,000 pages without routing source bytes through the web server.

```text
Presigned MinIO upload
-> qpdf/Poppler inspection
-> 20-page extraction and selective OCR
-> overlapping topic windows
-> complete inactive RAG index
-> existing review/automation
-> portable OKF v0.2 export
```

## Safety Boundaries

- Upload sessions are workspace and bundle scoped, expire after 15 minutes, and create a document only after object size, media type, and PDF magic bytes are verified.
- The processing worker streams the authoritative object to temporary storage while calculating SHA-256. It rejects encrypted, corrupt, oversized, and over-page-limit PDFs.
- OCR is local and English-only. Sparse raster pages are rendered at 300 DPI and retried once after deterministic preprocessing. Unreadable pages require action and block claims of complete indexing.
- Extraction, topic windows, and embedding batches use durable checkpoints. Completed work is not rewritten after a worker restart.
- The normal human-review and bundle-automation trust policy remains authoritative.

## Knowledge-Wide Discovery Boundary

Document ingestion does not crawl the raw document again after the full RAG index is built. It proceeds directly to enrichment so an optional knowledge-wide analysis cannot block document completion.

Knowledge-wide connection discovery is a separate bundle operation under **Relations -> Expand graph**. It reads active, approved, exported OKF concepts after enrichment and publication, proposes deterministic bundle-local connections, verifies each pair against exact evidence, and keeps every result pending until review. Adding documents expands the published concept corpus available to later runs without coupling those runs to ingestion.

## Resumability

Extraction checkpoints cover 20-page batches. Topic windows are capped at 12 pages or 18,000 tokens with two-page overlap and are keyed by content hash. Embedding batches contain at most 64 chunks or 50,000 tokens. A budget ceiling pauses indexing as `awaiting_budget`; it does not activate a partial index. Startup and hourly reconciliation safely replace the completed queue wrapper and resume the first incomplete embedding batch when budget becomes available.

The Processing panel reads these records directly and reports real pages, batches, OCR counts, discovery windows, and active stages. No synthetic percentage or separate UI-only job state is maintained.

## Portable Citations

Approved exports keep database coverage links for runtime use and write portable citations in frontmatter:

```yaml
av_okf_citations:
  - source: source-<sha256-prefix>
    chunks:
      - id: avchunk:<source-sha256>:<content-sha256>
        pages: [12, 13]
```

These identifiers contain no workspace, document, or database IDs. Export validates the source digest, chunk digest, cited pages, lifecycle, trust state, and relation targets.

## Rollout Gate

The production limit remains operationally provisional until a mixed text/scanned PDF over 100 MB and 1,000 pages and a mechanical 250 MB/5,000-page fixture complete successfully with recorded memory, duration, OCR, provider-cost, coverage, duplicate, and citation metrics. Multipart upload and non-English OCR remain future work.

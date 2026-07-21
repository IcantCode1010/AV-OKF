# Extraction Failure Investigation - Route Coverage Fixture

Date: 2026-07-20

## Reported symptom

The Documents UI showed an extraction failure after the real-document bulk
approval and export test.

## Finding

The failed extraction does not belong to the real `13 Air Ground.pdf` upload.
It belongs to the deterministic route-coverage evaluation fixture:

- Document ID: `route_coverage_eval_document_v1`
- Title: `Route Coverage Raw Operations Log`
- Stored object size: 46 bytes
- Failed job: `cmrtps5ge000c01l8fodb7qgb`
- Failure code: `malformed_pdf`
- Failure message: `PDF appears malformed or corrupt and could not be extracted.`

The fixture bytes are created in
`apps/web/scripts/route-coverage-eval.mts` as a minimal `%PDF-1.4` string. They
contain the PDF magic bytes but are not a structurally valid PDF. The route
evaluation script seeds extracted page records directly and indexes those
records, so it does not require PDF extraction. Manually selecting **Run
extraction** for this fixture predictably produces `malformed_pdf`.

## Real-document control result

The actual PDF used by the end-to-end test completed normally:

- Document ID: `doc_12cb7f5e-dc41-4e03-8805-3356b8a9e618`
- Title: `E2E Bulk Review - 13 Air Ground`
- Extraction job: `cmrtphc71000401l855dlzy1x`
- Extraction status: `completed`
- Extracted pages: 29
- RAG index job: `cmrtphccm00110iqkwm6oxxdj`
- RAG index status: `completed`

## Backend evidence

The extraction log recorded two attempts for the evaluation fixture, both with
the same normalized error:

```text
2026-07-20 20:55:39 - Extraction started.
2026-07-20 20:55:40 - PDF appears malformed or corrupt and could not be extracted.
2026-07-20 21:05:56 - Extraction started.
2026-07-20 21:05:56 - PDF appears malformed or corrupt and could not be extracted.
```

All Docker services remained healthy. No web or worker process crashed.

## Recommended correction

Evaluation fixtures should not appear as ordinary user documents with an
available extraction action. Prefer isolating route-evaluation data from the
normal product workspace or explicitly marking/filtering evaluation fixtures.
Replacing the placeholder with a valid PDF alone would be misleading because
re-extraction would overwrite the deliberately seeded raw evaluation pages.


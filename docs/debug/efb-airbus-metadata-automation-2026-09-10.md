# Airbus EFB Metadata Automation Verification

Date: 2026-09-10
Document: `doc_c89309b6-d53b-4364-9982-d52acad228f7`
Scope: 88 approved article revisions derived from the processed Airbus A319/A320 QRH

## Purpose

Verify the automated metadata changes against the document that exposed the
generic `needs correction` behavior. This run reused the existing extracted
pages and approved article revisions. It did not reprocess or re-upload the PDF.

## Baseline

- Ready: 47
- Needs review: 41
- Invalid-evidence issue present: 40
- Missing placement issue present: 23, overlapping the invalid-evidence set
- Model ambiguity: 1

## Execution

The EFB selections page filtered all 88 revisions to `a320` and submitted them
to the classification action. The action retained 48 current ready decisions
(including the previously repaired Normal operations checklist) and queued only
the 40 retryable non-ready decisions. The worker processed those jobs serially.

## Result

- Ready: 85
- Needs review: 3
- Queued/running: 0
- Failed/blocked: 0
- Bounded evidence repairs attempted: 5
- Evidence repairs succeeded: 3
- Invalid quotations discarded: 7 across 5 records
- Ready records retaining discarded-evidence audit data: 3

The increase from 47 to 85 ready articles came from two changes working
together: field-level evidence evaluation stopped unrelated invalid quotations
from invalidating a grounded required field, and the bounded repair call
recovered three required placement citations without changing the selected
category.

## Remaining review work

| Article | User-facing state | Deterministic reason |
|---|---|---|
| CIDS Reset and Uncommanded EVAC Horn Procedures | Choose QRH category | The repair model reported that no exact supporting quotation was available in the bounded evidence. |
| Engine Bleed System Reset Procedures | Choose QRH category | The selected QRH placement still has no exact supporting quotation after one repair attempt. |
| Navigation, smoke detection, and ventilation reset procedures | Review metadata | The placement model reported genuine ambiguity. |

These records remain excluded from automatic EFB selection. Approval,
selection, signed export, publication, and activation boundaries were unchanged.

## Repository validation

- Prisma client generation passed.
- Web lint passed.
- Web tests passed: 871 total, 866 passed, 5 skipped, 0 failed.
- Production build passed with the local verification authentication secret.
- OKF relation manifest lint passed.
- Relation-lint unit tests passed: 5 tests.
- Docker `web` and `worker` services rebuilt healthy, and the additive
  `extractionJobId` migration was present in PostgreSQL.

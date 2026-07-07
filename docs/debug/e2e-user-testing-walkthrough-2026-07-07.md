# E2E User Testing Walkthrough - 2026-07-07

## Purpose

Run the full end-to-end user testing profile (`docs/user-guides/end-to-end-user-testing-profile.md`)
against the Docker/VPS-style production stack, documenting per-flow results, backend evidence,
defects found, and fixes applied as a direct result of this run.

## Environment

- App URL: `http://localhost:3000`
- Stack: Docker Compose production data plane (`web`, `worker`, `postgres`, `redis`, `minio`,
  `caddy`, `knowledge-init`)
- Auth: local test-auth credentials (`test@av-okf.local`)
- Browser automation: `playwright-mcp` (Claude in Chrome was unavailable this session)
- Git commit at run start: `fce5d3a`

## Setup Note: Stale Docker Image

The Docker stack was already running when this session started, but the image had been built
**before** the current working tree's uncommitted Stage 6.6 changes, including:

- The `TopicRecord.exportedFilePath` migration (`20260707110000_topic_exported_file_path`) —
  present on disk as a migration file, never applied to the running database.
- An error-handling fix in `okf-actions.ts`'s `exportTopicToOkfAction` (try/catch around the
  metadata-missing case).

This produced two confusing false crashes early in the run (approving a topic, then any page load
for that document, threw `okf_export_missing_document_metadata` uncaught) before the mismatch was
diagnosed via `docker exec ... psql` column inspection and `_prisma_migrations` inspection.
Fix applied for this run:

```text
docker cp apps/web/prisma/migrations/20260707110000_topic_exported_file_path into av-okf-web-1
docker exec av-okf-web-1 node node_modules/prisma/build/index.js migrate deploy
docker compose build web
docker compose up -d --no-deps migrate web worker
```

After the rebuild, all further crashes reproduced were confirmed as real, current-code defects
(see Defects Found).

## Test Documents

Three PDFs generated for this run (reportlab, multi-page with real headings):

| Document | Pages | Purpose |
|---|---|---|
| `primary_aviation.pdf` (Boeing 737NG Hydraulic Power System AMM) | 5 | Primary aviation test document |
| `secondary_nonaviation.pdf` (Office Laser Printer Maintenance Guide) | 3 | Non-aviation genericity check |
| `invalid_renamed.pdf` (plain text renamed `.pdf`) | n/a | Malformed-upload negative test |

Document/topic IDs referenced below:

- `doc_84c1e56e-fc42-4946-b31d-d2e4a59ae040` — primary aviation document (later soft-deleted in Flow 7)
- Topic `cmrazxuql000a01qbcnucflaz` — "System B Electric Motor Driven Pump (EMDP)..." — approved,
  exported to `29-system-b-electric-motor-driven-pump-emdp-nominal-pressure-and-flow-08824e9dcd.md`,
  later marked `deleted` in the bundle explorer (Flow 7)
- `doc_a8e31baf-1180-471c-ad60-da705bcb458c` — secondary single-page aviation document, used for the
  enrichment-without-key and relation-validation failure scenarios
- `doc_fe475db4-5b61-4f46-98ec-c84ff65431ba` — non-aviation printer document, exported topic
  `00-2-toner-cartridge-replacement-a363a7ee95.md`

## User Flow Results

| Flow | Result | Notes |
|---|---|---|
| 1. Upload and extraction | Pass | 5-page PDF reached `ready`; storage path only appears in the inert Next.js RSC hydration payload, not rendered UI text |
| 2. Topic generation and manual review | Pass | Edit indicator shown; `originalTitle`/`originalSummary` confirmed unchanged at the DB level after editing `title`/`summary`; approved topics lock editing |
| 3. LLM enrichment | Pass | Real `gpt-4o-mini` run via a workspace-configured OpenAI key; audit row written to `TopicEnrichmentAudit`; raw vs. enriched shown side by side; `approvedContentSource=enriched` recorded on explicit approval |
| 4. OKF export | Pass | Clean failure on missing metadata; after filling it, export wrote the topic file plus updated `index.md`/`source_manifest.md`/`log.md`; `exportedFilePath` persisted matches the file on disk |
| 5. RAG indexing and search | Pass | Reindex updates `Last indexed` without touching bundle files; search returns title, page range, and a `raw extraction`/`raw` label |
| 6. Chat evidence cards | Pass | All four card types produced in one session: `APPROVED · OKF`, `NO EVIDENCE` (0 results, `missing_context` route), `RAW DOCUMENT`, `MIXED SOURCES` (`hybrid` route, 3 sources); an off-topic question routed to OKF honestly answered "does not directly answer this question" instead of fabricating |
| 7. Option-2 lifecycle deletion | Pass | Soft-delete wrote `deletedAt`/`deletedBy`/`deleteReason`; the doc's `raw_extraction` chunk flipped to `isActive=false`; OKF files stayed on disk; marking the exported topic `deleted` in the bundle explorer made the identical chat question fall back from `APPROVED · OKF` to `RAW DOCUMENT` |
| 9. Non-aviation PDF | Pass, with findings | Upload/extraction/topics/search fully generic; OKF export forced aviation-shaped metadata (see Defects Found — resolved same session) |

Flow 8 (failure scenarios) results:

| Scenario | Result |
|---|---|
| Upload malformed PDF | **Failed** at run time (crash) — see Defects Found; fixed same session |
| OKF export with missing metadata | Pass — clean inline error |
| Enrichment without a provider key | Pass — "Add an AI enrichment API key in Settings before enriching topics." |
| Chat with no supporting evidence | Pass — `NO EVIDENCE` card |
| Mark OKF file deleted, confirm chat stops treating it as approved | Pass (see Flow 7) |
| Relation validation with a missing target file | Pass — forced an invalid target via DOM injection (the UI dropdown only offers real files); server rejected with `relation_target_missing`, no relation was added, no crash |

## Defects Found

### 1. Malformed PDF upload crashed the UI

Uploading a non-PDF file renamed to `.pdf` threw `invalid_pdf_magic_bytes` from
`production-document-service.ts`'s `assertPdfMagicBytes` call, uncaught by
`uploadDocumentAction` (`apps/web/src/app/(app)/documents/actions.ts`), producing Next's generic
"Something went wrong" screen instead of a readable message. Reproduced on the freshly rebuilt
image, ruling out stale-build noise.

### 2. Metadata save crashed on a non-numeric classification code

Saving `"N/A"` in the (then-named) ATA field threw `invalid_ata_format` from
`normalizeAtaMetadata`'s strict `\d{2}(-\d{2}){0,2}` regex, uncaught by
`updateDocumentMetadataAction`, same crash screen. This also demonstrated the underlying
genericity problem directly: the OKF export metadata schema (`aircraftFamily`/`manualType`/`ata`)
had no accommodation for a non-aviation document like the printer manual.

## Fixes Applied This Session

1. **Both actions now catch their known validation errors and redirect with a message** instead of
   letting them reach the render boundary — `RECOVERABLE_UPLOAD_ERRORS` /
   `RECOVERABLE_METADATA_ERRORS` sets in `actions.ts`, rendered via new `uploadError` /
   `metadataError` banners on `/documents` and `/documents/{id}?panel=metadata`.
2. **OKF export metadata genericized**: `aircraftFamily`/`manualType`/`ata` renamed to
   `subjectFamily`/`documentType`/`classificationCode` across the Prisma schema (migration
   `20260707120000_generic_document_metadata`), both backend implementations, `okf-export.ts`,
   `okf-bundle-retriever.ts`, the metadata UI, and the `system_topic` entry in `okf-base.yaml`. The
   classification code no longer enforces the aviation ATA numeric format — any non-empty string
   up to 64 characters is accepted. One pre-existing committed OKF file
   (`32-main-gear-brake-system-494f144a6e.md`) and `source_manifest.md` used the old frontmatter
   keys and were migrated to keep `okflint` passing.

Both fixes were re-verified live against a rebuilt image: the non-PDF upload now shows "This file
isn't a valid PDF," a `classificationCode` of `"N/A"` now saves cleanly, and an overly long
classification code shows "Classification code is too long (64 characters max)" instead of
crashing.

## Backend Evidence

Confirmed via direct `docker exec ... psql` queries during the run:

```text
TopicRecord.originalTitle / originalSummary unchanged after title/summary edit
TopicRecord.approvedContentSource = 'enriched' after explicit enriched-content approval
TopicEnrichmentAudit row: provider=openai, model=gpt-4o-mini, succeeded=true
TopicRecord.exportedFilePath matches the actual filename written under /data/knowledge
Document.deletedAt / deletedBy / deleteReason populated after soft-delete
RagChunk.isActive = false for the soft-deleted document's raw_extraction chunk
okflint validate --manifest okf-base.yaml: pass (0 errors) after the field-name migration
tools/okf_relation_lint.py --manifest okf-base.yaml: pass (0 violations)
```

## Final Completed Result

```text
primary document reached ready: yes (5 pages)
topic reviewed and exported to OKF: yes
knowledge bundle preview shows exported + reserved files: yes
raw RAG search: pass
chat distinguishes OKF/raw/mixed/no-evidence: pass (all 4 card types observed)
source-document soft-delete disables raw RAG, preserves OKF: pass
OKF lifecycle deletion removes file from trusted chat retrieval: pass
non-aviation document processed generically end to end: pass
"Something went wrong" on the happy path: none observed
"Something went wrong" on failure paths: 2 found, both fixed same session
```

## Follow-Up Items

1. Consider a shared helper for the "catch known Error messages, redirect with a query-param
   message" pattern now duplicated across `uploadDocumentAction`, `updateDocumentMetadataAction`,
   and `exportTopicToOkfAction` — worth extracting once a fourth call site appears.
2. The relation-target dropdown still lists OKF files marked `deleted` as valid new relation
   targets. Not necessarily wrong (a `supersedes` relation may legitimately point at a retired
   concept), but worth a product decision.
3. `docs/architecture/okflint-profile.md`'s `dispatch_reference` example and the other 12
   aviation-specific OKF types in `okf-base.yaml` still require `aircraft_family`/`manual_type`/
   `ata` — intentionally out of scope for this fix since the app doesn't export to them yet, but
   they'll need the same treatment if/when a second domain pack is added.

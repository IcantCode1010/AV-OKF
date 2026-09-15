# OKF v0.2 Production Cutover Review

## Outcome

The backed-up v0.2 hard cutover completed on 2026-08-06. Production now has no
active v0.1 bundle. Portable archive import remains disabled and is the next
separately reviewed slice.

## Migrated Production Content

- `737ng`: 48 approved concepts and two source PDFs.
- Source PDFs received SHA-256 portable identities and bundle-local source
  reference concepts.
- `source_manifest.md` was replaced by source-reference concepts; its previous
  content and the old log were retained in a deprecated history concept.
- All active profiles were activated as immutable v0.2 versions.
- Worker reconciliation completed 54 OKF concept embeddings after migration.

## Backups And Reports

- Final database/vault backup:
  `C:\projects\AV-OKF\backups\okf-v02-20260806-163537`
- Final apply report:
  `C:\projects\AV-OKF\backups\okf-v02-20260806-163537\okf-v02-cutover-2026-08-06T20-35-40-351Z.md`
- Pre-cleanup reversible backup:
  `C:\projects\AV-OKF\backups\pre-v02-cleanup-20260806-162957`
- Reviewed clean dry-run report:
  `docs/debug/okf-v02-cutover-2026-08-06T20-31-14-913Z.md`

Local backup directories are ignored by Git and must be retained according to
the operator's backup policy.

## Verification

- Node tests: 532 executed, 530 passed, 2 skipped, 0 failed.
- ESLint: passed.
- Next.js production build: passed.
- Dedicated v0.2 validation: seven active bundles passed with zero issues.
- Relation lint: seven active bundles passed with zero violations.
- `okflint==0.3.1`: all active vaults conformant. It emits its known warning
  that it expects manifest version `0.1`; the dedicated v0.2 validator is the
  authoritative version gate until upstream recognizes v0.2.
- Docker route coverage: 24/24 scenarios passed with zero route, scope,
  citation, trust, or lifecycle failures.
- Docker bundle deletion: source preservation, citation tombstoning,
  idempotency, read-only history, cleanup, and reassignment all passed.
- Browser smoke: explorer graph/tree/reader rendered, v0.2 source references
  were visible, approved topic provenance rendered, and the PDF action targeted
  `/api/documents/doc_d1bc2a01-636f-40ba-a592-ab7c90c8f934/file#page=402`.

## Defects Found And Corrected

- Prisma 7 migration construction bypassed the configured adapter.
- Source-object migration queried `original` instead of `original_pdf`.
- Directory-less empty bundles could not activate.
- The maintenance wrapper did not initially fail on native process errors.
- Migration staging omitted bundle-local `okf-base.yaml` manifests.
- Document-deletion logging failed when a disposable bundle directory was
  already absent.
- The route evaluator recreated its foreign isolation bundle as v0.1.
- OpenAI strict structured output rejected optional `entityCandidates`, causing
  deterministic answer fallback despite correct retrieval.

Each defect was fixed and its affected gate was rerun successfully.

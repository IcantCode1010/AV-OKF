# EFB release readiness review — 2026-09-03

## Result

The AV-OKF pipeline can now build and cross-validate immutable EFB release artifacts, but the local B737 ATA 24 source set is not ready for publication. No real article has been marked EFB-eligible by this work.

## Current ATA 24 evidence

The local vault contains a 96-page file named `03 Electrical Power.pdf` with 79 discovered topics. Two topics are marked `approved`, 76 are `needs_review`, and one is `rejected`.

The document metadata contradicts the extracted source:

- The vault title says `737NG AMM 32 Landing Gear` and the ATA field says `32`.
- The extracted pages identify `ELECTRICAL POWER`, `24-00-00`, and `737 NG`.
- The vault authority says `Boeing Aircraft Maintenance Manual`.
- The source cover identifies an Airbus Maintenance Training student book and explicitly says it is an uncontrolled training document, not authority over controlled manuals.
- The vault revision says `2026-06`; the source cover shows training revision `2.0.0-20231128`.

The two legacy-approved topics do not contain human reviewer identity, approval timestamp, enriched display body, source hash, EFB inclusion metadata, or a reliable exported authority label. They cannot satisfy the EFB exporter.

## Recommended first review pair

These are candidates for human review, not approved content:

1. `Electrical Power System Overview`, grounded in source page 2.
2. `AC Generation Overview`, grounded in source pages 39–41.

They were selected because their page ranges and headings are coherent and they provide a useful ATA 24 vertical slice. A qualified reviewer must compare the complete proposed articles with the cited pages, correct any extraction errors, confirm the license and permitted use, and explicitly record approval.

## Required corrections before release 0.1.0

1. Correct the document identity to a B737 NG electrical-power training reference, ATA 24.
2. Replace the claimed AMM authority and 2026 revision with the source's actual training-document authority and revision.
3. Record an acceptable package license and attribution; do not infer it from the PDF.
4. Produce complete display-ready bodies for the two candidate articles.
5. Record `human:<reviewer>` verification events and exact timestamps.
6. Add stable IDs, Maintenance audience, `b738` applicability, ATA 24 and Quick Access placements, authority warning, content purpose, and inclusion status.
7. Commit the reviewed inputs, build from that clean commit, and run the Project EFB validator.

Until all seven steps pass, the existing Project EFB sample catalog must remain clearly labeled as deterministic evaluation content.

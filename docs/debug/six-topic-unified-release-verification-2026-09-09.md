# Six-topic unified release verification — 2026-09-09

## Corpus

The automated fixture contains six source-grounded technical topics: two
737NG, two 737MAX, and two A319/A320-family topics. Each source excerpt names
ATA 27 and either trailing-edge flaps or rudder.

## Result

`apps/web/src/lib/knowledge/six-topic-release.integration.test.mts` passed.

- Deterministic aircraft classification selected `737-ng`, `737-max`, and
  `a320` twice each, retained family-wide applicability, and selected ATA 27.
- The profile-driven compiler produced one root, two hubs, and six technical
  articles. All six technical articles were reachable from the root.
- Materialization added portable Markdown links and one `part_of` relation to
  every technical article.
- Native schema 2.1 packaging produced nine entries, keyword retrieval data,
  checksums, a signature envelope, and `native/navigation-report.json`.
- The mocked Project EFB HTTP receiver exercised initialize, artifact upload,
  batched validation, completion, release preparation, inspection, and
  explicit activation in order.

## Environment boundary

The local Docker environment exposed only AV-OKF's Postgres service. No Project
EFB receiver container was running, and `EFB_PUBLISHER_URL` and
`EFB_PUBLISHER_TOKEN` were not configured. Therefore this automated run proves the
complete client and receiver-contract sequence without external writes; it does
not claim a live Project EFB development activation. Live publication remains
blocked until a Project EFB publisher account and trusted Ed25519 key are
provisioned.

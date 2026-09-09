# EFB Publisher Contract Status

The publishing sequence is defined by [the supplied phased plan](../roadmap/efb-publisher-phased-plan.md), as corrected by the newer [Modular OKF Navigation Compiler Requirements](modular-okf-navigation-compiler-requirements.md). The newer requirements take precedence for navigation, relationship vocabulary, and receiver ownership. Complete compiler phases A-G before publishing its compiled output. Package generation is not publication or activation.

## Phase 0: In Progress

Inspected local package: `selected-cmr2lf3s0000101suuz8cz5mn@0.1.1788914818819`.

| Check | Observed |
| --- | --- |
| Manifest schema | 2.1 |
| Native catalog entries | 79 |
| Manifest articles | 79 |
| Placements | 79, all `ata:27` |
| Audiences | maintenance |
| Source reference records | 179 (plan examples say 176) |
| Declared related-entry references | 0 |
| Signature | Absent; unsigned prototype |

These are inventory observations, not a completed checksum, graph, or publisher validation. No root entry was identifiable by the expected ATA 27/root naming; inspect native links and node roles before concluding whether a root exists. Reachability for all 79 technical articles is not established. Root and hub nodes must be counted separately from technical articles if added.

## External Provisioning Still Required

- Provision a real Project EFB user with an enabled `okf_publishers` row for development publication.
- Add AV-OKF's Ed25519 public signing key to Project EFB's `EFB_OKF_TRUSTED_KEYS` configuration.
- Configure the development `EFB_PUBLISHER_URL` and short-lived publisher bearer token outside the repository.

These are deployment prerequisites, not unresolved application-contract decisions. They block remote publication and activation only; local classification, navigation compilation, package construction, validation, and dry-run planning remain available without them.

## Required Publisher Behavior

- Extend the current package compiler with a publisher CLI; preserve the shared exporter and general-purpose OKF format.
- Default to inspection/dry-run until the destination and contracts are established.
- Validate actual inventory, checksums, metadata parity, allowed placements, and wiki reachability before uploading.
- Keep ATA 27/maintenance as this acceptance corpus's constraints, not universal rules for future packages.
- Keep uploads immutable, imports transactional, and activation a separate atomic pointer change. Production activation requires explicit authorization and `--activate`.
- Retain previous package content; rollback changes activation state only.
- Report actual counts. Do not fabricate relationships to satisfy an example count or mark graph validation passed without traversal checks.

No remote publication or activation was performed during this inventory. Phases 1-10 are not complete.

## Receiver Compatibility Review (2026-09-08)

The installed Project EFB validator passed the current package's schema, reference, artifact, checksum, and keyword-index validation without signature enforcement. This does not establish publisher graph readiness.

Recounting each entry's relationship list confirmed **zero** relationships. The earlier count of one was an inventory aggregation error. The 79 native concept files contain no Markdown links identified by the link inventory. There is no declared wiki root/hub structure, so the publisher's root reachability gate remains unmet.

Project EFB already owns Supabase migrations. Its implemented receiver differs from the proposed foundation:

| Proposed plan | Existing EFB receiver |
| --- | --- |
| `okf_packages.status` and `storage_path` | `okf_packages.state` and `artifact_prefix` |
| `okf_articles` | `okf_entries` |
| `okf_article_links` | `okf_links` |
| `okf_article_sources` | `okf_sources` |
| Per-package `okf_active_packages` | Catalog-wide `okf_catalog`, `okf_releases`, and `okf_release_packages` |
| `okf-packages` private bucket | `okf-artifacts` private bucket |
| Service-role activation | Authenticated authorized publisher RPC |

Do not create conflicting `okf_packages` definitions or a second activation pointer. The receiver migrations are the authoritative deployed interface until an explicitly coordinated change replaces them. Adapt the publisher to that interface while preserving immutable upload, transactional import, verification, and rollback requirements. Catalog activation must preserve other active packages.

Source references: Project EFB migrations `20260904000300_okf_catalog.sql`, `20260904000500_okf_evidence.sql`, `20260904000900_okf_publication.sql`, and `20260907000100_vector_storage.sql`. Inspect the latest replacement activation function, not only the initial definition, before implementing activation.

Receiver-contract alignment is resolved by the newer navigation requirements: use Project EFB's existing receiver and publication RPC, without parallel tables or activation pointers. The development publication destination remains unconfirmed. No Phase 1 migration has been applied. Existing package files remain untouched.

## Receiver Contract Re-verification (2026-09-09)

The current `Project-EFB-MX` checkout confirms that AV-OKF must treat `POST /api/publish` as the sole publication boundary. The Vercel function accepts Bearer authentication, verifies the caller with Supabase Auth, and requires `require_okf_publisher()` before dispatching any action. AV-OKF must not connect directly to Project EFB's Supabase tables or RPCs.

The publication saga is resumable and action based:

| Stage | `/api/publish` action | Receiver behavior |
| --- | --- | --- |
| Register | `initialize` | Verifies the schema 2.1 manifest and Ed25519 signature, then creates the immutable package and artifact inventory. |
| Transfer | `upload` | Returns a signed upload URL for one declared artifact in the private `okf-artifacts` bucket. |
| Import | `validate` | Downloads and hashes uploaded artifacts, parses native OKF content, and imports entries, sources, and links while marking artifacts verified. |
| Complete | `complete` | Builds retrieval-document and asset rows, then calls service-role-only `complete_okf_package`. |
| Candidate | `prepare` | Calls `prepare_okf_release`; rejects invalid package sets and unresolved cross-package links and returns a candidate release UUID. |
| Inspect | `inspect` | Returns the candidate release inventory for pre-activation verification. |
| Activate | `activate` | Calls the latest `activate_okf_release` definition and atomically changes `okf_catalog.release_id`. |
| Roll back | `activate` with a retained revision | Restores a prior catalog by pointer change only; it does not upload, import, or copy content again. |
| Retire | `retire` | Retires a non-active release. This is lifecycle cleanup, not rollback. |

The authoritative receiver consists of 16 tables across the current migrations: `okf_packages`, `okf_assignments`, `okf_entries`, `okf_links`, `okf_releases`, `okf_release_packages`, `okf_catalog`, `okf_withdrawals`, `okf_publishers`, `okf_sources`, `okf_artifacts`, `okf_assets`, `okf_retrieval_documents`, `retrieval_builds`, `retrieval_chunks`, and `retrieval_embeddings`. Project EFB owns these tables and their migrations. AV-OKF will create no parallel publication schema.

The latest activation contract is the `create or replace function public.activate_okf_release(target_revision uuid)` definition in `20260907000100_vector_storage.sql`. It preserves the validated-release checks from the original catalog migration and also prevents a catalog release from retaining a retrieval build belonging to another release. Publisher implementation must follow this latest definition rather than the superseded initial function body.

Project EFB's runtime validator requires `schemaVersion: "2.1"`, `format.name: "open-knowledge-format"`, SHA-256 artifact checksums, and an Ed25519 manifest signature whose key ID is trusted by `EFB_OKF_TRUSTED_KEYS`. This matches AV-OKF's existing `poc-cloud` exporter contract. Unsigned prototype packages remain local-only and cannot enter the receiver.

This re-verification completes the receiver-mapping portion of Stage 1. No remote call, schema migration, publication, or activation was performed.

## Controlled Development Candidate (2026-09-09)

A signed 15-article 737 NG/ATA 27 package was accepted by the deployed Project
EFB receiver and prepared as an inactive candidate:

- Package: `selected-cmr2lf3s0000101suuz8cz5mn@0.1.1788996576377`
- Candidate release: `686d1fee-bf97-4ba4-9787-de87924bb81f`
- Retained active release: `305e7ff4-ae3e-45ea-a452-94e935be1752`
- Inventory: 15 technical articles, one root, nine hubs, 78 verified artifacts,
  25 retrieval documents, and 63 resolved link rows
- Receiver state: package `validated`, release `candidate`, activated `false`

The candidate preserves the previously active package in its two-package
catalog. Project EFB's current source table contains no rows for either the
existing or candidate package; article source references remain embedded in
the immutable manifest, agent artifacts, and native OKF metadata. Activation
remains a separate explicit operation.

## Accepted Navigation Direction

- Implement a reusable profile-driven navigation compiler through phases A-G in the newer requirements.
- Represent ATA 27 as a versioned profile containing one root and nine hubs, never chapter-specific shared code.
- Classify membership using approved assignment, source hierarchy, structured classification, deterministic profile rules, then manual assignment. Reject unexplained unassigned articles.
- Generate `part_of` membership with target type and reason using the existing `okf-base.yaml` vocabulary. Root and hub Markdown links establish downward navigation. The earlier proposed `contains`, `parent`, and generic `related` vocabulary is superseded.
- Preserve approved source-supported technical relations separately from generated navigation. Zero technical relations is acceptable when every article is reachable through navigation.
- Report 79 technical articles separately from the root and hubs; compute actual edge counts.
- Record source commit, compiler version, profile ID/version, package version, and checksum in a new immutable release.
- Prove reuse with ATA 27, another ATA chapter, and a pilot/QRH fixture; run the existing receiver validator.
- The publisher consumes validated output without classification, graph generation, or package mutation.

Compiler implementation can proceed locally without Supabase credentials. Remote publication follows after compiler acceptance and destination configuration. No compiler phase is marked complete by accepting these requirements.

## Phase A Implementation

Implemented the strict navigation profile schema, safe named/versioned YAML loader, deeply frozen normalized configuration, and source checksum. `apps/web/config/navigation/737-flight-controls.v1.yaml` defines all nine ATA 27 hubs, root, structured match rules, ordering, article types, and standalone policy.

Verification: six focused tests passed, and focused ESLint passed. Tests cover configuration loading, unsafe YAML/paths, unsupported registry values, duplicate IDs, ambiguous rules, and schema reuse across another ATA chapter and QRH. Phase A's configuration gate passes. Phases B-G remain outstanding; no articles or existing package artifacts were modified and no publication took place.

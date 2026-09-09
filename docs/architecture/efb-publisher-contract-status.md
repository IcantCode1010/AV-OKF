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

## Contract Decisions Still Required

- Identify the development Supabase destination and authorized activation/rollback operators without storing credentials in this document.
- Assign ownership and location of Supabase migrations; coordinate with Project EFB's existing database contract before creating parallel tables.
- Define explicit root and subsystem node roles and supported native internal-link resolution, including fragments and package boundaries.
- Define how `contains`, `parent`, and `related` publishing links map to existing OKF relations without altering their meaning.
- Define unsigned prototype acceptance in development. Existing signed cloud acceptance remains a separate receiver requirement; an unsigned package must not be advertised as cloud-approved.

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

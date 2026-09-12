# Project EFB package acceptance contract

**Contract version:** 1.0
**Producer:** AV-OKF
**Consumer:** Project EFB
**Purpose:** Define the exact release package AV-OKF must produce before Project EFB may stage it.

## Instructions to the implementing agent

Treat this document as a normative interface contract. The words **MUST**, **MUST NOT**, **SHOULD**, and **MAY** have their usual requirements meaning.

Implement or update only the AV-OKF EFB exporter and its tests as needed to satisfy this contract. Do not change the general OKF 0.2 format or make ordinary OKF exports depend on Project EFB metadata.

The exporter MUST fail closed: if any required field, artifact, relationship, checksum, signature, or cross-artifact parity check fails, it MUST NOT leave a completed release directory.

Before implementation, compare this contract against the current Project EFB sources identified in [Consumer-owned contract](#consumer-owned-contract). If the consumer contract has changed, stop and report the incompatibility instead of guessing.

## Required export mode

Provide a direct-to-EFB PoC cloud export mode. It MAY be named `poc-cloud` or another unambiguous equivalent.

This mode:

- MUST produce the schema 2.1 package described here.
- MUST include the original native OKF articles.
- MUST create a valid Ed25519 package-integrity signature.
- MUST run structural validation and Project EFB's validator.
- MUST NOT require topic approval, license review, reviewer identity, a clean Git worktree, or operational-data approval.
- MUST label every entry as prototype content that is not approved operational guidance.
- MUST treat `approved-for-inclusion` as “selected for this prototype package,” not as technical approval.

The existing unsigned schema 2.0 PoC package is suitable for legacy/build-time import only. Project EFB's cloud publisher MUST receive schema 2.1.

## Required directory

The completed directory MUST be named:

```text
<package-id>@<version>/
```

It MUST contain:

```text
<package-id>@<version>/
├── manifest.json
├── retrieval.jsonl
├── display/
│   └── <entry-id>.md
├── agent/
│   └── <entry-id>.json
└── native/
    ├── catalog.json
    ├── tree/
    │   └── <native-okf-path>.md
    └── assets/
        └── <optional-supporting-assets>
```

The handoff directory SHOULD also contain:

```text
release.json
checksums.sha256
acceptance-report.json
```

These three operator-facing files are not upload artifacts and MUST NOT be included in the manifest artifact checksum.

## Manifest requirements

`manifest.json` MUST:

- Have `schemaVersion: "2.1"`.
- Have `format.name: "open-knowledge-format"`.
- Have `format.version: "0.2"`.
- Use an `id` equal to `<packageId>@<version>`.
- Use an immutable version. Any content or metadata change requires a new version.
- Contain between 1 and 10,000 entries.
- Contain unique, stable entry IDs.
- Contain the complete `placements` array.
- Contain `nativeArtifacts`, listing every uploaded path under `native/`.
- Contain a SHA-256 checksum for the exact upload inventory.
- Contain an Ed25519 signature from a Project EFB-trusted signing key.

For PoC cloud releases, use values equivalent to:

```json
{
  "license": {
    "identifier": "POC-NOT-REVIEWED"
  },
  "trust": {
    "validationProfile": "poc-structural-only"
  }
}
```

Every entry MUST use:

```json
{
  "authorityLabel": "Prototype knowledge — not approved operational data",
  "inclusionStatus": "approved-for-inclusion"
}
```

## Required entry fields

Each manifest entry MUST contain:

- `id`
- `packageVersionId`
- `title`
- `summary`
- `tags`
- `audiences`
- `contentArtifactPath`
- `agentArtifactPath`
- `sourceReferences`
- `relatedEntryIds`
- `applicability`
- `authorityLabel`
- `inclusionStatus`

`packageVersionId` MUST equal the manifest `id`.

`audiences` MUST contain one or both of:

```text
pilot
maintenance
```

The display article, agent artifact, native article, retrieval record, and manifest MUST agree on identity, package version, title, audience, applicability, placements, and authority label.

## Aircraft applicability

Every entry MUST have at least one aircraft family or aircraft type.

The Project EFB IDs currently accepted by the cloud publisher are:

| Scope | Accepted IDs |
| --- | --- |
| Aircraft family | `737-ng`, `a320` |
| Aircraft type | `b738`, `a320-251n` |

Whole-family 737 NG content MUST use:

```json
{
  "aircraftFamilyIds": ["737-ng"],
  "aircraftTypeIds": []
}
```

737-800-only content MUST use:

```json
{
  "aircraftFamilyIds": ["737-ng"],
  "aircraftTypeIds": ["b738"]
}
```

Do not infer a specific variant when the source supports only family-level applicability. Source identifiers such as `737SAR` are provenance and MUST NOT be used as aircraft IDs or placements.

## EFB placements

Every entry MUST have at least one placement appropriate to its audience. Placement IDs MUST be stable and unique within the package. Every placement's `entryId` MUST resolve to a manifest entry.

### Maintenance placement

Maintenance content MUST use an ATA placement with a two-digit chapter target:

```json
{
  "id": "placement-hydraulic-reservoir-ata29",
  "entryId": "hydraulic-reservoir-servicing",
  "kind": "ata",
  "targetId": "29",
  "displayOrder": 10
}
```

The ATA chapter must come from evidence-backed article classification. Low-confidence or ambiguous content MUST remain unplaced and MUST fail the complete package until corrected or excluded.

### Pilot placement

Pilot content MUST use `kind: "qrh"` and a stable target ID from this registry:

```text
airplane-general
air-systems
anti-ice-rain
automatic-flight
communications
electrical
engines-apu
fire-protection
flight-controls
flight-instruments-displays
flight-management-navigation
fuel
hydraulics
landing-gear
warning-systems
procedures
maneuvers
miscellaneous
```

Example:

```json
{
  "id": "placement-hydraulic-operation-qrh",
  "entryId": "hydraulic-operation-overview",
  "kind": "qrh",
  "targetId": "hydraulics",
  "displayOrder": 10
}
```

The exporter MUST NOT generate new QRH target IDs. A new category requires an explicit Project EFB contract revision.

### Quick Access

`quick-access` MUST be explicitly requested by package configuration or curated metadata. It MUST NOT be inferred merely because an article appears important.

An entry MAY have multiple placements without duplicating the article.

## Required article representations

Every entry MUST have all four representations below.

### Display article

`display/<entry-id>.md` MUST contain:

- A nonempty title and body.
- Display-ready Markdown.
- No scripts, executable content, raw storage links, or unsafe HTML.
- A visible prototype warning.
- Meaningful source references or locators.

### Agent artifact

`agent/<entry-id>.json` MUST contain at minimum:

```json
{
  "schemaVersion": "1.0",
  "entryId": "hydraulic-reservoir-servicing",
  "packageVersionId": "737-ng-hydraulics@1.0.0",
  "title": "Hydraulic Reservoir Ground Servicing",
  "summary": "Reference material covering reservoir servicing.",
  "body": "Agent-readable article content.",
  "audiences": ["maintenance"],
  "applicability": {
    "aircraftFamilyIds": ["737-ng"],
    "aircraftTypeIds": []
  },
  "placements": [],
  "authorityLabel": "Prototype knowledge — not approved operational data"
}
```

The agent body MUST contain the complete useful article content, not only its summary.

### Native OKF article

Every exported source article MUST appear under `native/tree/` with valid OKF 0.2 YAML frontmatter and a nonempty body.

Its frontmatter MUST include:

- `type`
- `efb_entry_id`
- `efb_audiences`
- `efb_aircraft_type_ids`
- `efb_aircraft_family_ids` when family applicability exists
- `efb_placements`
- `efb_license_identifier`
- `efb_authority_label`
- `efb_inclusion_status`

The native metadata MUST agree with the manifest. `efb_inclusion_status` MUST be `approved-for-inclusion` for entries included in the package.

### Retrieval record

`retrieval.jsonl` MUST contain exactly one nonblank JSON record per manifest entry and no duplicate `entryId` values.

Each record MUST include:

```json
{
  "schemaVersion": "1.0",
  "entryId": "hydraulic-reservoir-servicing",
  "packageVersionId": "737-ng-hydraulics@1.0.0",
  "title": "Hydraulic Reservoir Ground Servicing",
  "summary": "Reference material covering reservoir servicing.",
  "searchableText": "Complete normalized searchable article text...",
  "tags": ["hydraulics", "reservoir", "servicing"],
  "audiences": ["maintenance"],
  "aircraftFamilyIds": ["737-ng"],
  "aircraftTypeIds": [],
  "placements": []
}
```

`searchableText` MUST be nonempty and no longer than 1,000,000 characters. It SHOULD contain the title, summary, aliases, tags, headings, and useful article body text.

The package MUST NOT contain generated embeddings. Project EFB stores these retrieval documents and builds embeddings as a replaceable derived index after ingestion.

## Native catalog

`native/catalog.json` MUST contain:

- `schemaVersion: "1.0"`
- `formatVersion: "0.2"`
- `packageVersionId`
- `packageId`
- `version`
- The same `license` object as the manifest
- An `entries` array matching the manifest entries exactly, with only `nativePath` added
- An `assets` array, empty when no assets exist

Every `nativePath` MUST resolve to exactly one declared artifact under `native/tree/`.

## Relationships

`relatedEntryIds` and native OKF links MUST use stable identities.

- Same-package relationships MAY use a local entry ID.
- Cross-package relationships MUST use a version-qualified OKF reference.

Example:

```text
okf://737-ng-electrical@1.2.0/generator-control
```

The exporter MUST reject unresolved local relationships. A cross-package link that is expected to participate in a release MUST resolve during Project EFB catalog preparation. Do not use article titles as relationship identities.

## Supporting assets

Optional supporting assets are limited to:

- `application/pdf`
- `image/png`
- `image/jpeg`
- `image/webp`

Each asset MUST:

- Be declared in `native/catalog.json` with `nativePath`, `entryId`, `title`, and `mediaType`.
- Have exactly one owning entry.
- Appear as `native/assets/<nativePath>` in `nativeArtifacts`.
- Be nonempty and no larger than 3,000,000 bytes.
- Match the file signature of its declared media type.
- Pass its SHA-256 check.

Executables and disguised file types MUST be rejected.

## Paths and artifact inventory

All artifact paths MUST:

- Be relative.
- Use forward slashes.
- Already be normalized.
- Contain no `.` or `..` path segments.
- Contain no empty path segments.
- Contain no backslashes, control characters, colons, question marks, or percent signs.

The upload inventory MUST equal exactly:

```text
every entry.contentArtifactPath
every entry.agentArtifactPath
retrieval.jsonl
every manifest.nativeArtifacts path
```

There MUST be no duplicate, missing, or undeclared upload paths.

`manifest.json` signs the inventory and therefore MUST NOT hash itself. `release.json`, `checksums.sha256`, and `acceptance-report.json` also remain outside the upload inventory.

The package checksum MUST be the SHA-256 of Project EFB's stable JSON serialization of the sorted array of `{ path, sha256 }` artifact records.

The Ed25519 signature MUST cover this exact payload, including the final newline:

```text
project-efb-knowledge-package-v2
<manifest.id>
sha256:<manifest.checksum.value>

```

Private signing keys MUST NOT be written into the release folder, repository, logs, tests, or acceptance report.

## Acceptance report

The exporter SHOULD write `acceptance-report.json` after all checks pass. It SHOULD contain only non-secret operational evidence:

```json
{
  "contractVersion": "1.0",
  "packageVersionId": "737-ng-hydraulics@1.0.0",
  "result": "pass",
  "entryCount": 23,
  "retrievalRecordCount": 23,
  "displayArtifactCount": 23,
  "agentArtifactCount": 23,
  "nativeEntryCount": 23,
  "assetCount": 0,
  "packageChecksum": "<sha256>",
  "signatureKeyId": "<non-secret-key-id>",
  "validatedAt": "<ISO-8601 timestamp>",
  "checks": {
    "okf02": "pass",
    "efbSchema21": "pass",
    "artifactCoverage": "pass",
    "metadataParity": "pass",
    "placementCoverage": "pass",
    "relationshipResolution": "pass",
    "assetValidation": "pass",
    "consumerValidator": "pass"
  }
}
```

Do not emit a passing report until every required check has passed.

## Mandatory validation sequence

The exporter MUST perform these steps in order:

1. Validate every selected source article as OKF 0.2.
2. Classify and validate aircraft applicability, audience, and EFB placement.
3. Generate display, agent, native, and retrieval artifacts.
4. Check exact metadata parity across all representations.
5. Resolve same-package relationships.
6. Validate supporting assets.
7. Build the exact sorted artifact inventory.
8. Calculate all SHA-256 values and the package checksum.
9. Sign the package checksum.
10. Validate the completed manifest using Project EFB's schema and validator with signature enforcement.
11. Write the final directory using an atomic rename.
12. Write the passing acceptance report.

The Project EFB validator invocation MUST be equivalent to:

```powershell
node "$env:PROJECT_EFB_ROOT\scripts\validate-knowledge-package.mjs" `
  "<release-directory>\manifest.json" `
  --require-signature `
  --public-key "<trusted-public-key-file>" `
  --expected-key-id "<trusted-key-id>"
```

Validation MUST use the public key only. The private signing key is used solely by the signing step.

## Hard rejection conditions

Do not produce a completed EFB-ready directory when any of these are true:

- Schema is not 2.1 or OKF format is not 0.2.
- Package ID and version do not form the manifest ID.
- The version was already released with different contents.
- An entry lacks a required representation.
- Counts differ between manifest, native catalog, and retrieval records.
- Audience, applicability, placement, or identity differs between artifacts.
- An entry has no supported aircraft scope.
- A maintenance entry has no valid two-digit ATA placement.
- A pilot entry has no recognized QRH placement.
- A relationship is malformed or a required target cannot be resolved.
- An asset is missing, oversized, undeclared, disguised, or has no owner.
- A path is unsafe or the upload inventory has missing, duplicate, or extra artifacts.
- A checksum differs.
- The signature is missing, invalid, or uses an untrusted key ID.
- Project EFB's validator fails.

## Catalog and embedding boundary

AV-OKF produces immutable packages. It MUST NOT edit Project EFB's active catalog, database, vector index, or deployment manifests directly.

The receiving workflow is:

```text
AV-OKF export
  → Project EFB structural validation
  → immutable cloud staging
  → catalog diff preparation
  → optional retrieval/embedding build
  → atomic catalog activation
```

Package upload MUST NOT overwrite unrelated packages or topics. Project EFB composes the next catalog from explicitly selected immutable package versions. The existing active catalog remains in service until the complete replacement catalog is activated.

Embeddings are derived from `retrieval.jsonl`, versioned separately, and replaceable. An embedding failure MUST NOT invalidate or replace the currently active knowledge catalog or embedding index.

## Definition of done

Implementation is complete only when:

- A representative 737 NG family package passes every acceptance gate.
- A maintenance article is placed under its correct ATA chapter.
- A pilot article is placed under its correct QRH category.
- Family-level applicability does not invent a specific variant.
- A deliberately corrupted checksum is rejected.
- A deliberately mismatched audience, aircraft scope, or placement is rejected.
- A deliberately unresolved relationship is rejected.
- A deliberately oversized or spoofed asset is rejected.
- The Project EFB validator passes with `--require-signature`.
- Existing general OKF export remains operational without EFB metadata.
- Existing immutable release directories remain unchanged.

## Consumer-owned contract

Project EFB is the authority for the receiving contract. Validate against these files from the configured `PROJECT_EFB_ROOT`:

```text
contracts/schemas/knowledge-package.schema.json
scripts/validate-knowledge-package.mjs
server/publication.ts
server/assets.ts
scripts/publish-knowledge.mjs
```

AV-OKF is the authority for source ingestion, article generation, evidence-backed classification, and export. Project EFB is the authority for package acceptance, authorization, catalog composition, activation, rollback, retrieval indexing, embeddings, and runtime agent access.

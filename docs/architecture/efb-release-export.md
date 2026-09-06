# EFB release export boundary

AV-OKF remains the authoring authority. Project EFB remains the runtime authority for identity, authorization, active-release selection, article display, retrieval, and agent access. The projects exchange immutable release artifacts; they do not share a database or read each other's mutable working directories.

The exporter has two explicit modes:

- **PoC:** automatically packages every completed aviation article after document authoring. It does not require topic approval, license review, reviewer identity, or a digital signature. Every article is labeled `Unreviewed prototype knowledge — not approved instructions`, and `approved-for-inclusion` means only that the article is included in the prototype package.
- **Production:** retains the strict human-review, license-review, clean-commit, and Ed25519-signing requirements documented below.

PoC mode is enabled in the local Docker stack with `AV_OKF_EFB_EXPORT_MODE=poc`. Set the value to `disabled` to stop automatic package generation. Production publication remains an explicit signed CLI operation.

## Automated PoC package

When an aviation authoring run reaches `ready_for_review`, a deterministic durable job snapshots all completed aviation articles in that bundle. The job builds the existing Project EFB contract through the same exporter and writes one importable folder:

```text
dist/efb-releases/<package-id>@<version>/
  manifest.json
  display/<entry-id>.md
  agent/<entry-id>.json
  retrieval.jsonl
  checksums.sha256
  release.json
```

Article IDs are stable hashes of AV-OKF topic IDs. After enrichment, each aviation article receives a bounded evidence-backed classification stored under `extensions.projectEfb`. It contains aircraft family and variants, audience, supported ATA chapter, confidence, provider/model, status, and exact source evidence. The classifier checks explicit ATA references, section hierarchy, the validated document default, article content, and Project EFB's supported taxonomy in that order.

The exporter uses the accepted article classification first and invokes the same classifier as a legacy fallback when it is missing. A valid document-level ATA remains the default while an accepted article classification can override it. Unsupported or ambiguous content is left unplaced. Source identifiers and publication codes remain provenance only; for example, `737SAR` may appear in a source-reference label but can never become an ATA placement.

Titles, summaries, full enriched bodies, tags, source pages, classified aircraft applicability, audiences, and placement are projected into the package. Before checksums are calculated, AV-OKF compares the manifest, every agent artifact, and every retrieval row and fails the release if applicability, audience, or placement differs. Missing required content fails the complete job.

The worker stages the package, invokes Project EFB's existing `validate-knowledge-package.mjs`, and only then atomically moves the directory into `dist/efb-releases`. A failed validation leaves no importable final directory. Job status and the final folder name appear in document-processing progress.

Existing aviation topics can be classified again without re-ingesting their PDFs:

```powershell
pnpm --dir apps/web maintenance:classify-project-efb -- <document-id> --queue-release
```

## Production included-entry profile

An OKF 0.2 article is eligible for an EFB release only when it is stable, human-reviewed, has at least one source, and carries all of these extension fields:

| Field | Purpose |
| --- | --- |
| `efb_entry_id` | Stable URL, citation, and retrieval identity. Lowercase letters, numbers, and hyphens only. |
| `efb_audiences` | One or both of `pilot` and `maintenance`. |
| `efb_aircraft_type_ids` | Project EFB aircraft applicability IDs such as `b738`. |
| `efb_placements` | One or more `kind:target:order` values. Kinds are `ata`, `qrh`, or `quick-access`. |
| `efb_authority_label` | User-visible authority and operational-use warning. |
| `efb_license_identifier` | Must match the package-level license. |
| `efb_license_reviewed_by` | Human or accountable process that confirmed the package may use the source under this license. |
| `efb_license_reviewed_at` | ISO 8601 timestamp for that license review. |
| `efb_content_purpose` | Curator-declared purpose, such as `maintenance-reference`. |
| `efb_inclusion_status` | Must be `approved-for-inclusion`. |
| `efb_related_entry_ids` | Optional stable IDs; every target must be in the same immutable package version. |
| `efb_source_classification` | One of `controlled-document`, `open-reference`, or `training-reference`. |

The exporter ignores ordinary OKF articles that have no `efb_inclusion_status`. Once an article opts into EFB publication, missing or invalid metadata fails the complete release. It also rejects truncated article fields, undersized or heading-free display bodies, missing source pages, ATA placement conflicts, known B738/A320 applicability conflicts, and training sources mislabeled as maintenance manuals or approved data. This prevents partial or accidental publication.

## Immutable output

`export:efb-release` creates:

- `manifest.json`: Project EFB knowledge-package contract v2.0.
- `display/<entry-id>.md`: display-ready article content.
- `agent/<entry-id>.json`: agent-readable content and exact authorization metadata.
- `retrieval.jsonl`: structured keyword records. Embeddings are not required.
- `checksums.sha256`: content checksums for transport verification.
- `release.json`: source commit, package checksum, and retrieval build metadata.

The command requires an Ed25519 release private key and the Project EFB contract root. It signs a domain-separated payload containing the immutable package ID and artifact checksum, then validates the generated manifest with Project EFB's own JSON Schema before reporting success. The release config pins the AV-OKF Git commit; exporting from a different commit or a dirty worktree fails. A package ID and version can be written only once, and output is staged before an atomic directory rename so a failed build cannot appear as a complete release.

## Example command

```powershell
$env:PROJECT_EFB_ROOT = "C:\projects\Project-EFB-MX"
pnpm export:efb-release -- --config efb-release.json --knowledge-root knowledge --out dist/efb-releases --signing-private-key C:\secure\efb-release-ed25519.pem --signing-public-key C:\secure\efb-release-ed25519.pub.pem --signing-key-id publisher-2026
```

Release activation and cloud upload are intentionally outside this command. They belong to the Project EFB control plane so an exported package can be staged, verified, atomically activated, and rolled back.

## Human-review packet

Before setting EFB inclusion metadata, prepare a non-approving packet from the local vault:

```powershell
pnpm prepare:efb-review -- --vault .data/document-vault.json --config ../../docs/architecture/efb-ata24-review-config.json --out ../../work/efb-review/b738-ata24-review-packet.json
```

The packet preserves exact page text and SHA-256 evidence, reports conflicting source metadata, proposes stable entry IDs and placements, and leaves every technical, applicability, authority, and license checklist item false. It never changes the vault or topic approval state. Generated packets are ignored by Git because they may contain extracted source material.

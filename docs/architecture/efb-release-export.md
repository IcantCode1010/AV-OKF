# EFB release export boundary

AV-OKF remains the authoring and review authority. Project EFB remains the runtime authority for identity, authorization, active-release selection, article display, retrieval, and agent access. The projects exchange immutable release artifacts; they do not share a database or read each other's mutable working directories.

## Included-entry profile

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

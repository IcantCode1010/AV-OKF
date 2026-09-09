# EFB Publisher Phased Plan

> Implementation precedence: the subsequently supplied [Modular OKF Navigation Compiler Requirements](../architecture/modular-okf-navigation-compiler-requirements.md) supersede this plan's proposed navigation vocabulary and new Supabase schema. Use the existing Project EFB receiver and activation RPC. Complete compiler phases A-G before publishing; the original proposal below is retained for traceability.

## Purpose

## Handoff: 2026-09-08

- Navigation compiler Phase A is complete: strict schema, safe versioned loader,
  immutable normalized configuration, and the ATA 27 profile with nine hubs.
  Six focused tests and focused lint passed.
- Next: Phase B of the navigation requirements, generating root and hub pages
  and deterministic relative Markdown links. Then implement membership (C),
  technical relations (D), graph validation (E), package integration (F), and
  three-profile modularity tests (G), honoring each exit gate.
- The current immutable package has 79 maintenance articles, 79 ATA 27
  placements, 179 source references, and zero technical relationships. The
  existing EFB structural validator passes; root/hub reachability is not yet
  implemented. Preserve this package and create a new version for navigation.
- The Articles page now has bulk draft approval. Unsigned `poc-local` package
  export permits prototype inspection without signing configuration. Signed
  `poc-cloud` remains available with configured keys. Neither is proof of remote
  publication or activation.
- Use Project EFB's existing Supabase tables, private bucket, and activation
  RPC. Do not implement the superseded parallel schema proposed below.
- Development Supabase destination remains unconfirmed; local compiler work
  does not depend on it. No publisher upload, import, or activation is complete.
- Prior full Node tests and Docker build passed before Phase A. Standalone
  full-project `tsc --noEmit` reported existing test-fixture type errors; do not
  describe that check as passing. Phase A has focused tests/lint only.

See [contract status](../architecture/efb-publisher-contract-status.md) for
receiver mapping and [navigation requirements](../architecture/modular-okf-navigation-compiler-requirements.md)
for the authoritative next implementation.

## Publisher Purpose

Build an occasional-use publisher in the OKF project that validates an immutable EFB knowledge package, uploads it to Supabase, imports its wiki content, and activates the new version safely.

The publisher is a release tool. It runs only when new content is ready. Agent runtime, chat, wiki traversal, and answer generation are outside this plan.

## Target Workflow

```text
OKF content
    ↓
Compile immutable EFB package
    ↓
Validate package and wiki links
    ↓
Upload to Supabase Storage
    ↓
Import into Supabase Postgres
    ↓
Verify imported records
    ↓
Atomically activate package version
```

## Ownership

### OKF project

- Creates and maintains articles.
- Compiles and validates EFB packages.
- Owns the publisher CLI.
- Initiates publication when content is ready.

### Supabase

- Stores immutable package releases.
- Stores articles, placements, links, and sources.
- Preserves package history and activation state.

### Future agent runtime

- Searches, opens, and traverses active articles.
- Compiles answers and citations.

---

# Phase 0 — Confirm the Contracts

## Objective

Agree on the package and publishing rules before implementation.

## Tasks

- [ ] Confirm the canonical package schema versions.
- [ ] Confirm package IDs use `<package-id>@<version>`.
- [ ] Confirm all current articles belong to maintenance and ATA 27.
- [ ] Confirm how the ATA 27 root and subsystem hub pages are represented.
- [ ] Confirm the supported OKF internal-link syntax.
- [ ] Start with `contains`, `parent`, and `related` relationship types.
- [ ] Confirm the development Supabase project.
- [ ] Assign ownership of Supabase migrations.
- [ ] Identify who can activate and roll back packages.

## Deliverables

- [ ] Package contract documented.
- [ ] Publisher-to-Supabase contract documented.
- [ ] Development destination confirmed.

## Exit Gate

The developer can explain what makes a package valid, what will be stored, how activation works, and how rollback works.

---

# Phase 1 — Create the Supabase Foundation

## Objective

Create the minimum Storage and database structure.

## Required Tables

### `okf_packages`

One immutable record per package version:

```text
id
package_id
version
package_version_id
checksum
source_commit
storage_path
status
manifest
created_at
validated_at
activated_at
failure_reason
```

Statuses:

```text
uploading | staged | validated | active | retired | failed
```

Constraints:

- [ ] `package_version_id` is unique.
- [ ] `(package_id, version)` is unique.
- [ ] Published content cannot be overwritten.

### `okf_articles`

```text
id
package_record_id
entry_id
node_type
title
summary
agent_body
display_markdown
native_markdown
authority_label
aircraft_family_ids
aircraft_type_ids
audiences
tags
metadata
```

`node_type` is `wiki_root`, `section`, or `article`. The pair `(package_record_id, entry_id)` must be unique.

### `okf_placements`

```text
article_id
kind
target_id
display_order
```

The initial package uses `kind = ata` and `target_id = 27`.

### `okf_article_links`

```text
source_article_id
target_article_id
relationship
link_label
source_heading
display_order
```

### `okf_article_sources`

```text
article_id
source_reference_id
label
locator
```

### `okf_active_packages`

```text
package_id
active_package_record_id
activated_at
activated_by
```

Importing a package must not automatically activate it.

## Storage

Create a private `okf-packages` bucket using immutable paths:

```text
okf-packages/<package-id>/<version>/package.zip
okf-packages/<package-id>/<version>/manifest.json
okf-packages/<package-id>/<version>/acceptance-report.json
```

## Security

- [ ] Make the bucket private.
- [ ] Enable Row Level Security where tables are exposed to clients.
- [ ] Prevent browser users from importing or activating packages.
- [ ] Keep service credentials in server-side configuration only.
- [ ] Exclude credentials from Git and logs.

## Exit Gate

Version-controlled migrations create all tables, constraints, indexes, and the private Storage structure in development.

---

# Phase 2 — Build the Publisher CLI

## Objective

Create a local command that can inspect a package without publishing it.

## Proposed Structure

```text
apps/web/
├── scripts/publish-efb-package.mts
├── src/lib/efb-publisher/
│   ├── config.ts
│   ├── types.ts
│   ├── validate-package.ts
│   ├── build-publish-plan.ts
│   ├── upload-package.ts
│   ├── import-package.ts
│   ├── activate-package.ts
│   └── publish-report.ts
└── src/lib/efb-publisher/__tests__/
```

Add:

```json
{
  "scripts": {
    "publish:efb": "tsx scripts/publish-efb-package.mts"
  }
}
```

Command:

```text
publish:efb <package-path>
  --dry-run
  --environment development|production
  --activate
  --no-activate
  --json
```

Configuration:

```text
EFB_SUPABASE_URL
EFB_SUPABASE_SERVICE_ROLE_KEY
EFB_SUPABASE_PACKAGE_BUCKET=okf-packages
EFB_SUPABASE_ENVIRONMENT=development
```

## Tasks

- [ ] Validate environment configuration.
- [ ] Parse CLI arguments.
- [ ] Refuse unknown environments.
- [ ] Ensure secrets never appear in output.
- [ ] Add `--dry-run` with no external writes.
- [ ] Produce human-readable and optional JSON summaries.

## Exit Gate

The current 79-article package completes `--dry-run` and produces an accurate publish plan.

---

# Phase 3 — Validate the Package and Wiki

## Objective

Reject incomplete or internally broken packages before upload.

## Package Validation

- [ ] Parse `manifest.json` and `native/catalog.json`.
- [ ] Parse all agent JSON artifacts.
- [ ] Parse every `retrieval.jsonl` record.
- [ ] Require display, agent, native, and retrieval representations for every entry.
- [ ] Confirm counts, entry IDs, and package versions match.
- [ ] Confirm declared files exist and no undeclared inventory files are present.
- [ ] Verify all SHA-256 checksums.

## Placement Validation

- [ ] Every current article has a maintenance placement.
- [ ] Every current placement uses `kind = ata`.
- [ ] Every current placement uses `target_id = 27`.
- [ ] Display orders are valid and deterministic.

## Wiki Graph Validation

- [ ] Resolve every `relatedEntryId`.
- [ ] Parse and resolve native OKF links.
- [ ] Reject duplicate, broken, and unsupported links.
- [ ] Identify the ATA 27 root.
- [ ] Verify subsystem hubs are reachable from the root.
- [ ] Verify every technical article is reachable.
- [ ] Report orphan and isolated articles.

Produce a report like:

```json
{
  "root": "ata-27-flight-controls",
  "articleCount": 79,
  "reachableArticleCount": 79,
  "relationshipCount": 0,
  "brokenLinks": [],
  "orphanArticles": [],
  "duplicateIds": [],
  "result": "pass"
}
```

Use the actual compiled relationship count rather than the example value.

## Exit Gate

A valid package passes; missing files, checksum failures, broken links, and unexplained orphan articles fail deterministically.

---

# Phase 4 — Upload Immutable Releases

## Objective

Upload a validated package without allowing a version to be replaced.

## Tasks

- [ ] Archive the package deterministically.
- [ ] Calculate the final checksum.
- [ ] Check for an existing package version.
- [ ] Upload the archive, manifest, and acceptance report.
- [ ] Create the package row with status `staged`.
- [ ] Record the checksum, source commit, and Storage paths.

## Idempotency

- New version: upload and continue.
- Existing version with the same checksum: report `already published` and exit successfully.
- Existing version with a different checksum: reject and require a new version.

## Exit Gate

Publishing the same package twice creates no duplicate objects or database records.

---

# Phase 5 — Import the Wiki Transactionally

## Objective

Import the staged package without exposing partial content.

## Import Sequence

1. Insert articles.
2. Insert ATA 27 placements.
3. Insert source references.
4. Resolve stable article IDs.
5. Insert article relationships.
6. Verify expected and imported counts.
7. Run graph validation against imported records.
8. Mark the package `validated`.

The import must run in a transaction. If anything fails:

- Roll back all imported wiki records.
- Keep the original Storage object.
- Mark the package `failed`.
- Record a safe failure reason.
- Leave the active package unchanged.

## Required Parity Checks

```text
expected articles = imported articles
expected placements = imported placements
expected sources = imported sources
expected relationships = imported relationships
expected reachable articles = imported reachable articles
```

## Exit Gate

The current package imports all 79 articles, while a deliberately broken import leaves no partial wiki visible.

---

# Phase 6 — Activate Atomically

## Objective

Make a validated package active without mixing package versions.

## Activation Transaction

1. Lock the active-package record.
2. Confirm the new package is `validated`.
3. Record the previous active version.
4. Change the active pointer.
5. Mark the previous version `retired`.
6. Mark the new version `active`.
7. Record activation time and actor.

## Rules

- [ ] Staged and failed packages cannot be activated.
- [ ] Activation never deletes previous versions.
- [ ] Failed activation preserves the previous active version.
- [ ] Only one version of a package can be active.
- [ ] Production activation requires the explicit `--activate` option.

## Exit Gate

Readers can see either the complete previous package or the complete new package, never a partial mixture.

---

# Phase 7 — Add Rollback

## Objective

Reactivate a previous validated version without reimporting it.

Command:

```powershell
pnpm --dir apps/web publish:efb -- rollback `
  --package-id <package-id> `
  --version <version> `
  --environment development
```

## Tasks

- [ ] Confirm the target version exists and passed validation.
- [ ] Atomically change the active pointer.
- [ ] Update active and retired statuses.
- [ ] Record the rollback actor and time.

Rollback must not delete, reimport, overwrite, or otherwise modify historical package content.

## Exit Gate

A previous validated version can be restored with one command and no data loss.

---

# Phase 8 — Reports and Runbook

## Objective

Make publication auditable and operable by another developer.

Write a report to:

```text
work/efb-publishes/<package-version-id>.json
```

Example:

```json
{
  "packageVersionId": "selected-package@0.1.0",
  "checksum": "sha256-value",
  "sourceCommit": "git-commit",
  "publishedAt": "ISO timestamp",
  "storagePath": "okf-packages/selected-package/0.1.0/package.zip",
  "articleCount": 79,
  "placementCount": 79,
  "relationshipCount": 0,
  "sourceCount": 176,
  "previousVersion": null,
  "result": "active"
}
```

The report must not contain credentials.

## Documentation Tasks

- [ ] Configure a development publisher.
- [ ] Run `--dry-run`.
- [ ] Publish without activation.
- [ ] Activate a validated package.
- [ ] Roll back a package.
- [ ] Diagnose failed uploads and imports.
- [ ] Rotate Supabase credentials.

## Exit Gate

Another authorized developer can publish and roll back a test package using only the runbook.

---

# Phase 9 — Version Control and CI

## Objective

Make publisher changes and releases repeatable and reviewable.

## Commit to Git

- Publisher source and tests.
- Package schemas.
- Supabase migrations.
- Non-secret example configuration.
- Operational documentation.
- Changelog entries.

## Do Not Commit

- Supabase credentials or service-role keys.
- Production database exports.
- Private source documents.
- Generated archives unless intentionally maintained as test fixtures.

## Package Version Rules

- [ ] Keep the same package ID for the same knowledge set.
- [ ] Assign a new version whenever content changes.
- [ ] Never reuse a published version for different content.
- [ ] Record the checksum and source Git commit.
- [ ] Preserve all previous versions.

Timestamp-based prototype versions may continue. Semantic versions can be adopted later without changing this model.

## CI Checks

- [ ] Type checking passes.
- [ ] Unit and integration tests pass.
- [ ] Package and graph validation tests pass.
- [ ] Database migrations apply cleanly.
- [ ] Dry-run integration test passes.
- [ ] No credentials are present in tracked files.
- [ ] Production publishing requires an explicitly authorized workflow.

## Exit Gate

Publisher code cannot merge with failing tests, and production publication cannot occur accidentally.

---

# Phase 10 — End-to-End Prototype Acceptance

## Objective

Demonstrate the complete lifecycle with the current package.

Dry run:

```powershell
pnpm --dir apps/web publish:efb -- `
  "dist/efb-releases/selected-cmr2lf3s0000101suuz8cz5mn@0.1.1788914818819" `
  --environment development `
  --dry-run
```

Then perform an authorized development publication.

## Expected Result

```text
Package validation: passed
Upload: completed
Articles imported: 79
ATA 27 placements imported: 79
Relationships imported: <actual count>
Source references imported: 176
Graph validation: passed
Package activated: yes
Previous package preserved: yes
Result: success
```

## Verification

- [ ] Original package exists in private Storage.
- [ ] All 79 articles exist in Postgres.
- [ ] All 79 articles are placed under ATA 27.
- [ ] All source references are present.
- [ ] All declared relationships resolve.
- [ ] Every article is reachable from the ATA 27 root.
- [ ] Exactly one version is active.
- [ ] Previous versions remain unchanged.

## Failure Tests

- [ ] Republishing the same package creates no duplicates.
- [ ] Reusing a version with a different checksum is rejected.
- [ ] A broken link prevents activation.
- [ ] A forced import failure exposes no partial wiki.
- [ ] Rollback restores the previous validated version.

## Exit Gate

The lifecycle succeeds end to end:

```text
validate → upload → import → verify → activate → retry safely → roll back
```

---

# Milestone Tracker

| Phase | Milestone | Status |
|---|---|---|
| 0 | Contracts confirmed | Not started |
| 1 | Supabase foundation created | Not started |
| 2 | Publisher CLI skeleton complete | Not started |
| 3 | Package and graph validation complete | Not started |
| 4 | Immutable upload complete | Not started |
| 5 | Transactional wiki import complete | Not started |
| 6 | Atomic activation complete | Not started |
| 7 | Rollback complete | Not started |
| 8 | Reports and runbook complete | Not started |
| 9 | CI and release controls complete | Not started |
| 10 | End-to-end prototype accepted | Not started |

Use these status values:

```text
Not started | In progress | Blocked | Ready for review | Complete
```

---

# Definition of Done

- [ ] One command validates and publishes a package.
- [ ] `--dry-run` makes no external changes.
- [ ] Original packages are stored immutably.
- [ ] All representations are imported consistently.
- [ ] ATA 27 placements are preserved.
- [ ] Wiki relationships resolve and are traversable.
- [ ] Import is transactional.
- [ ] Activation is atomic.
- [ ] Republishing the same version is safe.
- [ ] Changed content requires a new version.
- [ ] Rollback changes only the active pointer.
- [ ] Secrets remain out of code, logs, and reports.
- [ ] Code, migrations, tests, and documentation are version-controlled.
- [ ] Agent runtime remains outside this implementation.

## Final Developer Instruction

> Add an EFB Publisher CLI to the OKF project. It must validate an immutable OKF package, upload it to private Supabase Storage, import its articles, ATA 27 placements, source references, and wiki relationships into Postgres, verify the imported graph, and atomically activate the new package version. Publishing must be idempotent, every version must remain immutable, and rollback must only change the active-version pointer. Keep all agent runtime, chat, traversal orchestration, and answer-generation work outside this implementation.

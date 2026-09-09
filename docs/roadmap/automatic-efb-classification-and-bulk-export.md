# Automatic EFB classification and bulk export plan

Date: 2026-09-08  
Status: implementation connected; production rollout acceptance pending

## Implementation checkpoint — 2026-09-08

### Source-metadata-first follow-up

The EFB selections workspace now includes **Apply metadata to approved
articles**. This idempotently synchronizes approved enriched aviation topics to
immutable article revisions, evaluates their saved source metadata against the
consumer-owned registry, and selects only ready revisions. The subsequent
**Build EFB import package** action uses the existing signed, validated exporter;
the resulting artifact is downloaded for import into the separate Project EFB
application and is not activated by AV-OKF. Missing, ambiguous, stale or
unsupported placement remains visible as a correction requirement.

Aviation now uses document metadata for aircraft, audiences and placement scope.
Metadata discovery inspects a bounded first-12-page view for registry-valid ATA
and QRH headings, retaining exact evidence in the proposal audit. It does not
overwrite entered values. Metadata editing exposes separate receiver-registry
checkbox lists. A singleton scope or unique exact source heading resolves the
topic section; multi-section ambiguity requires explicit topic metadata selection.
Enrichment retains these fields and article revisions snapshot them. Generic
classification remains on its existing path; aviation does not call another
model to guess placements during EFB classification.

Review opens on bulk enrichment when unenriched topics exist. Failed enrichment
output now fails the queue job and retries instead of recording a false completion.
Existing approved topics and immutable packages are not re-exported by this change.

Verification: full Node/component suite, lint, Docker production build, compatibility
corpus and local PostgreSQL additive migration passed. Browser inspection confirmed
the Review controls and live registry-backed document fields. PostgreSQL array
round-trip was tested in a rolled-back transaction. No real-topic batch or EFB
release was submitted during verification. A new-provider ingestion-to-export run
remains an acceptance step, not a completed evaluation.

Current data attention: the retained 20 FUEL source has contradictory entire-family
and explicit-variant metadata. The mounted EFB registry also lacks ATA 28. Correct
the source applicability and intentionally update the receiver registry before
expecting that document's articles to export. Do not silently remap fuel to another
chapter. The earlier model-placement description below is superseded for aviation.

Migration: `20260908150000_document_placement_scope` adds empty array columns only.
It was applied after a verified custom PostgreSQL backup. Rolling application code
back can leave these additive columns in place; no destructive rollback is needed.

Docker is available again. The PostgreSQL migration test preserves old history
and proves eight concurrent inserts allocate versions 3–10 without collisions.
All 51 migrations apply successfully to an isolated PostgreSQL database.
Both additive migrations are also applied to the local application database
after a verified backup; all 328 retained revisions remain and have versions.

Implemented registry snapshots, registry-constrained aircraft/ATA extraction,
constrained model audience/placement output, exact-quote checks, durable BullMQ
processing with database reconciliation, bounded retries, review forms and
decision history, approval-triggered selection, batch classification/selection,
queued signed export, source/registry/selection invalidation, and Activity items.
The legacy classifier's generation path now loads the consumer registry; its
historical metadata reader retains the old vocabulary for compatibility.

Version numbers are visible in article history, the article list, and batch
controls. New edits retain their parent and reason. Generated successors also
receive a parent automatically. EFB Markdown retains revision/version metadata.
Selected export now requires the current approved revision; earlier prototype
behavior that allowed drafts is superseded for this selected-article workflow.

The PostgreSQL/Redis integration fixture exercises prediction processing,
idempotency, approval-triggered selection, versioned editing, two transient
failures followed by successful retry, signed export with a reviewed PNG,
consumer validation, repeated delivery of an exported job, source-metadata
invalidation, and workspace isolation. Prediction responses and object storage
are fixture-backed; the database, queue, signature, and consumer validator are
real. This does not establish real-model aviation accuracy. The Docker
production build passes; the host's broad standalone TypeScript check retains
existing test-fixture diagnostics.

Rollout switches (default off): `AV_OKF_EFB_CLASSIFICATION_ENABLED`,
`AV_OKF_EFB_AUTO_SELECT_ENABLED`, and `AV_OKF_EFB_BULK_EXPORT_ENABLED`.
Classification and export workers are started by the existing worker process.
Use batch classification to backfill retained revisions. Review ambiguous rows
in each article; confirmed values are recorded separately from model output.

Remaining acceptance: assemble a reviewed representative real-aviation corpus,
run live-model precision evaluation, verify the complete browser/device workflow,
and exercise abrupt process termination during package writing. The precision
report command is `tsx scripts/evaluate-efb-classification.mts corpus.json`.
Each corpus row supplies `id`, `reviewedBy`, `expected`, `predicted`, and `status`;
metadata fields are audiences, aircraftFamily, aircraftTypeIds, ataChapter, and
qrhTargetId. It reports field precision and false-ready count. Passing precision
alone does not establish representative coverage or authorize rollout.

No activation in Project EFB is performed. Release retries fail closed if an
interrupted immutable output already exists; operator recovery of that case
remains an acceptance item. The release feature is not declared production-ready.

## Objective

Classify every EFB candidate while its article revision is created so an editor
does not have to assign aircraft, audience, and placement one article at a time.
The classifier must choose only values supported by the connected Project EFB
registry. Approved, export-ready revisions can then be selected and exported as
one immutable signed release.

The target flow is:

```text
source documents + inspected passages + article revision
  -> constrained EFB classification
  -> deterministic validation
  -> ready or needs-review queue
  -> article approval
  -> automatic EFB selection when eligible
  -> bulk preflight
  -> one signed release containing all selected revisions
```

Classification, article approval, EFB selection, export, and activation remain
separate recorded events. Automatic classification may prepare and select an
approved revision, but it does not approve an article or activate a release in
Project EFB.

## Classification contract

For each immutable article revision, produce one structured classification:

```ts
type EfbClassification = {
  schemaVersion: "1.0";
  audiences: Array<"pilot" | "maintenance">;
  aircraftFamilyIds: string[];
  aircraftTypeIds: string[];
  placements: Array<
    | { kind: "ata"; targetId: string }
    | { kind: "qrh"; targetId: string }
  >;
  effectivity: string | null;
  confidence: "high" | "medium" | "low";
  status: "ready" | "needs_review" | "blocked";
  rationale: string;
  evidence: Array<{
    documentId: string;
    pageNumber: number;
    passageId: string;
    supports: "audience" | "aircraft" | "placement" | "effectivity";
  }>;
  registryVersion: string;
  model: { provider: string; modelId: string; policyVersion: string };
  classifiedAt: string;
};
```

Store the result against `KnowledgeArticleRevision`, not only in
`KnowledgeEfbSelection.metadata`. This makes a classification immutable,
reviewable, and reproducible with the exact article and evidence that produced
it. Store editor overrides as a new decision record containing the prior value,
new value, actor, time, and reason. Never rewrite classification history.

## Allowed values and registry ownership

Project EFB's versioned knowledge registry is the publication contract and the
only allowed output vocabulary. AV-OKF must load or import a versioned snapshot
containing:

- aircraft families and their permitted aircraft type IDs;
- ATA chapter IDs;
- QRH target IDs;
- optional display labels and aliases;
- registry schema version and content hash.

The model receives compact candidate lists from this snapshot and returns IDs,
not invented labels. Server validation rejects an unknown ID, a family/type
mismatch, a maintenance result without an ATA placement, or a pilot result
without a QRH placement. A registry update marks classifications that use
removed or changed targets for review before another export.

Move human-readable QRH names and aliases into the shared registry. The current
EFB interface has categories such as Air Systems, Electrical, Engines/APU,
Flight Controls, Fuel, Hydraulics, Landing Gear, Warning Systems, Procedures,
and Maneuvers, while the import contract uses stable slug IDs. Classification
must target the stable ID and display the friendly name.

## Evidence and decision hierarchy

The classifier reads the finished article, but article prose alone is not enough
to establish aircraft applicability. Use evidence in this order:

1. Explicit aircraft family/type and effectivity metadata on the source.
2. Exact model, manual title, revision, applicability, or effectivity statements
   in inspected source passages.
3. Article content and title for subject classification.
4. Controlled aliases from the EFB registry.

Do not narrow family-wide material to one aircraft type merely because only one
type currently exists in Project EFB. If the evidence establishes `737-ng` but
not `b738`, save the family and leave type IDs empty. Conflicting aircraft or
effectivity evidence produces `needs_review`. No aircraft evidence produces
`blocked` for EFB selection.

Determine audience from purpose and authority:

- `pilot`: flight-deck recognition, indications, limitations, operational
  response, QRH organization, maneuvers, or pilot-facing system knowledge;
- `maintenance`: system construction, troubleshooting, testing, servicing,
  removal/installation, adjustment, inspection, or maintenance references;
- both: the article deliberately contains useful, supported content for both
  audiences and has a valid placement for each.

Source type is strong context, not a complete decision. A QRH-derived article
normally suggests `pilot`; an AMM/FIM/WDM-derived article normally suggests
`maintenance`. The model must classify the article's actual subject and cite
the evidence used.

For maintenance, select the ATA chapter from an explicit ATA code when present.
Otherwise use the registry's chapter descriptions and inspected passages. For
pilot, select the closest configured QRH category based on the operational
subject. A dual-audience article receives both an ATA and QRH placement. The
first release should allow one placement per audience; add multiple placements
only after duplicate navigation and ranking behavior are tested in EFB.

## Constrained model workflow

Add an `efb_classification` step after evidence-backed article synthesis and
before editorial approval:

1. Assemble the article title/body, source document metadata, applicable exact
   passages, and the current registry candidates.
2. Apply deterministic signals first: explicit ATA numbers, registered aircraft
   aliases, document applicability, and manual type.
3. Ask the configured workspace model for strict structured output covering the
   remaining audience and placement decisions.
4. Validate the output with a schema and the registry.
5. Reconcile model output with deterministic evidence. Deterministic aircraft
   applicability and exact ATA evidence win over a conflicting model choice.
6. Calculate status from field completeness, conflict checks, evidence coverage,
   and confidence. Do not trust a confidence number supplied by the model.
7. Persist the classification and show it on the article revision.

Run the step as a durable BullMQ job with idempotency key
`revisionId + registryHash + policyVersion`. Retry provider/transient failures
without creating duplicate classifications. A policy, source, article, or
registry change creates a new result; it does not mutate the old one.

## Readiness rules

A classification is `ready` only when all of these are true:

- at least one audience is selected;
- aircraft applicability comes from source-grounded evidence;
- every family and type exists in the registry and the hierarchy matches;
- every maintenance audience has a registered ATA target;
- every pilot audience has a registered QRH target;
- evidence references still resolve to active, authorized source passages;
- there are no unresolved applicability or placement conflicts;
- registry and classification policy versions are current.

Use `needs_review` for a supported result with ambiguity, including competing
ATA chapters, mixed pilot/maintenance intent, family-level versus type-level
uncertainty, or incomplete effectivity. Use `blocked` when required evidence is
missing, the source was withdrawn, the registry has no compatible aircraft or
placement, or classification execution failed.

## Automatic selection

When an editor approves a revision, automatically create or update its
`KnowledgeEfbSelection` only if its classification is `ready` and the revision
has no unresolved source-change warning. Copy the exact classification into the
selection and record `selectionMode: "automatic"`, the classification ID, and
the selecting approval event.

For `needs_review`, open the existing EFB selection form prefilled with the
recommendation and its evidence. Saving an override produces
`selectionMode: "reviewed"`. Blocked articles remain visible with a specific
reason and cannot enter a release.

If approval is revoked, a source is withdrawn, applicability changes, or the
registry no longer accepts the classification, mark the selection ineligible.
Previously generated releases remain immutable and auditable.

## Bulk review and export experience

Expand **EFB selections** into a release-preparation workspace with four groups:

- Ready and selected;
- Needs classification review;
- Blocked, with reasons;
- Already included in a previous release.

Support filters for aircraft, audience, ATA chapter, QRH category, collection,
approval date, and classification status. Provide Select all eligible, clear
selection, and per-row overrides. Grouping by aircraft and placement lets an
editor spot obvious outliers before export.

The bulk action must take a database snapshot of exact revision IDs,
classification IDs, registry hash, assets, and dependencies. Preflight the
entire snapshot before writing a package. If one item fails, report it by
article and leave the release in `validation_failed`; do not silently omit it.
Allow the editor to remove failed items and rerun preflight against a new
snapshot.

After preflight passes, one job creates the deterministic package, checksums,
signature, manifest, display files, agent artifacts, and retrieval index. Show
counts by aircraft, audience, and placement before the export starts and in the
acceptance report. Export still does not activate the release.

## Data and service changes

1. Add `KnowledgeEfbClassification` with revision, structured result, status,
   confidence, registry hash, policy/model provenance, evidence links, and
   timestamps.
2. Add `KnowledgeEfbClassificationDecision` for human confirmation or override.
3. Extend `KnowledgeEfbSelection` metadata with classification ID, selection
   mode, eligibility state, and invalidation reason.
4. Add a versioned EFB registry snapshot table or immutable configuration
   artifact. Remove duplicated hard-coded family labels after migration.
5. Add one shared classification service used by legacy enriched topics and the
   newer article-revision path.
6. Add batch classification/reclassification commands and progress reporting to
   the existing Activity system.
7. Extend `KnowledgeExportRelease.selectionSnapshot` to retain classification
   and registry identities used by the release.

Use an additive migration. Backfill approved revisions in bounded batches and
leave them unselected until their classification reaches `ready`.

## Delivery phases

### Phase 1: Registry and deterministic classifier

- Import and hash the Project EFB registry.
- Add display labels, aliases, ATA descriptions, and QRH descriptions without
  changing stable contract IDs.
- Implement schema validation and deterministic extraction for aircraft and ATA.
- Prove family/type normalization against the current 737-800 and A320neo keys.

### Phase 2: Model classification and review

- Add constrained audience and placement classification.
- Persist evidence-linked results and confidence derived from validation.
- Add the article classification card, explanations, override history, retry,
  and reclassify actions.
- Integrate the job into article creation and Activity progress.

### Phase 3: Automatic selection

- Connect approval to automatic selection for `ready` results.
- Prefill the existing form for review cases.
- Implement invalidation for source, approval, policy, and registry changes.
- Backfill current approved articles without auto-approving or auto-activating
  anything.

### Phase 4: Bulk release

- Add selection filters, grouped review, select-all-eligible, and batch editing.
- Add snapshot preflight and article-specific failure reports.
- Export one signed package from the validated snapshot.
- Preserve idempotency so retrying the same snapshot cannot create conflicting
  releases.

### Phase 5: Evaluation and rollout

- Run in shadow mode and compare predictions with editor choices.
- Enable visible suggestions after the evaluation threshold is met.
- Enable automatic selection only for classes that meet the threshold.
- Enable bulk export after end-to-end EFB contract and device verification.

Feature flags should separate classification, automatic selection, and bulk
export so each can be disabled without losing stored decisions.

## Verification corpus and acceptance gates

Build a reviewed corpus covering at least:

- each supported aircraft family and type;
- family-wide and type-specific articles;
- QRH, FCOM/FCTM, AMM, FIM, WDM, IPC, training, and mixed-source articles;
- every configured QRH category represented by available source material;
- representative ATA chapters;
- dual-audience, ambiguous, conflicting, missing-effectivity, and unsupported
  aircraft cases;
- source revision, withdrawal, and registry-change invalidation.

Measure exact-match accuracy separately for audience, aircraft family, aircraft
type, ATA placement, and QRH placement. Also measure false-ready rate, because a
wrong automatic selection matters more than an unnecessary review.

Initial rollout gates:

- zero unknown registry IDs or family/type mismatches reach package preflight;
- zero blocked or unapproved revisions enter an export snapshot;
- 100% of classifications retain resolvable supporting evidence;
- at least 98% precision on `ready` aircraft applicability;
- at least 95% precision on `ready` audience and placement decisions;
- all lower-confidence or conflicting cases route to review;
- the signed bulk package passes the Project EFB validator and every included
  entry is visible only for its intended aircraft and placement;
- retry, cancellation, restart, and stale-selection tests preserve an immutable,
  auditable release snapshot.

Run the first live acceptance with a small reviewed batch: several 737-800 QRH
topics, several 737 maintenance topics across different ATA chapters, one
dual-audience system article, and deliberate ambiguous/unsupported cases. An
editor compares every automatic decision with its source before enabling a
larger bulk release.

## Completion definition

This work is complete when a newly created evidence-backed article receives a
visible, source-grounded EFB classification; an approved high-confidence article
is selected automatically; ambiguous cases are efficiently reviewable; and an
editor can validate and export a batch as one signed, immutable Project EFB
package with no manual re-entry of aircraft, audience, or placement metadata.

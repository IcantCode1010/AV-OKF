# Automated EFB Metadata Capture Implementation Plan

Status: implemented and verified locally
Source design: [Automated EFB metadata capture](../architecture/automated-efb-metadata-capture.md)

## Verification result

The controlled Airbus QRH run completed on 2026-09-10 without rerunning PDF
extraction. All 88 approved A319/A320 article revisions were submitted through
the idempotent classification action; 48 current ready decisions were retained
and only the 40 non-ready decisions were queued.

- Baseline: 47 ready and 41 needing review.
- Result: 85 ready and 3 needing review.
- Five bounded citation-repair calls were attempted; three succeeded.
- Seven invalid evidence quotations were discarded without weakening exact
  quote validation.
- Two remaining articles need a QRH category that the bounded source evidence
  did not establish; one remaining article reports genuine model ambiguity.
- The application reports the remaining work as `Choose QRH category` (2) and
  `Review metadata` (1), with no queued, running, blocked, or failed records.

The detailed run record is in
[Airbus metadata automation verification](../debug/efb-airbus-metadata-automation-2026-09-10.md).

## Objective

Make EFB metadata capture automatic from completed PDF extraction through an
approved, package-eligible article revision. The system must use deterministic
document metadata first, call the LLM only for unresolved article placement,
retain exact page evidence for every accepted applicability or placement claim,
and continue processing unrelated articles when one record is ambiguous.

No metadata form or classification button should be required in the normal
path. Human approval, reviewed placement overrides, EFB selection policy,
signed publication, and activation remain separate existing boundaries.

## Verified starting point

The production pipeline already performs more automation than the initial
council review identified:

- `runProductionExtractionJob` calls
  `createKnowledgeAuthoringRunAfterExtraction` and enqueues the resulting run.
- `runKnowledgeAuthoringJob` executes resumable metadata, applicability,
  discovery, indexing, enrichment, EFB classification, relation, and validation
  stages.
- `importLegacyTopic` and `importBuilderRevision` call inherited EFB metadata
  classification when article revisions are created.
- `evaluateInheritedEfbMetadata` deterministically inherits aircraft and
  audience and resolves a placement without a model when document scope has one
  registered value.
- `processClassification` calls the placement model only when a multi-category
  source leaves ATA or QRH placement unresolved.
- `selectClassifiedRevision` requires the approved revision and a current ready
  classification and preserves reviewed selections.

The implementation therefore improves the existing path rather than creating a
new orchestrator, metadata table, or classification service.

## Scope

### Included

- Field-level validation of model classification evidence.
- One bounded repair attempt for a required placement citation.
- Automatic refresh of retryable non-ready classifications.
- Human-readable, field-specific metadata states.
- Verification and hardening of extraction-triggered authoring.
- Recovery/backfill for eligible older records.
- Metrics from existing authoring, classification, selection, and release data.
- Controlled testing on fixtures and the processed Airbus QRH.

### Deferred

- New optional metadata with no current Project EFB consumer.
- Combining article enrichment and placement classification into one call.
- A workspace-level automatic-selection setting.
- Automatic article approval, publication, or activation.
- Changes to the Project EFB registry vocabulary.

## Metadata contract for this milestone

Only existing consumed fields are included.

| Field | Authority | Persistence | Blocking rule |
|---|---|---|---|
| Source document, pages, evidence IDs, content fingerprint | Extraction | `KnowledgeArticleRevision.evidence`, `sourceFingerprint` | Required provenance |
| Document title/type/revision/effectivity/authority | Existing value, then bounded metadata discovery | `Document`; snapshot in article metadata/evidence where already supported | Missing values block only when the package contract requires them |
| Aircraft family/applicability | Aircraft applicability classifier plus deterministic normalization | `Document`; inherited classification result | Must resolve to a registered family with accepted/manual status |
| Audience | Document metadata | `Document`; inherited classification result | Must contain supported audience values |
| Document ATA/QRH scope | Exact document evidence plus registry validation | `Document` arrays | Used deterministically when single-valued |
| Article ATA/QRH placement | Single document scope, otherwise bounded placement model | `KnowledgeEfbClassification.result.metadata` | Required for each applicable audience and must have exact evidence unless inherited from a single validated scope |
| Registry/policy/input fingerprints, provider/model, confidence, issues | Classifier runtime | `KnowledgeEfbClassification` | Must be current at selection/export |
| Approval and reviewed override | Reviewer | Article approval and `KnowledgeEfbClassificationDecision` | Existing explicit boundary |
| Selection/export/release state | Existing workflow | Selection and release records | Existing explicit boundary |

## Phase 0 — Baseline and executable contract

### Work

1. Add a focused classification fixture representing the Airbus `Normal
   operations checklist` failure: one valid `qrh=procedures` citation plus an
   invalid extra citation.
2. Capture baseline counts for the current Airbus run:
   `ready`, `needs_review`, `blocked`, and issue-code frequency.
3. Document the required-field matrix:
   - pilot requires QRH placement;
   - maintenance requires ATA placement;
   - dual audience requires both;
   - inherited aircraft and audience are not model-derived again.
4. Treat `KnowledgeEfbClassification.result` as the compatibility boundary for
   this milestone. Additive JSON properties are allowed; no migration is needed
   for field-level diagnostics.

### Likely files

- `apps/web/src/lib/knowledge/efb-classification-policy.test.mts`
- `apps/web/src/lib/knowledge/efb-inherited-metadata.test.mts`
- A focused classification service test beside
  `apps/web/src/lib/knowledge/efb-classification.ts`
- `docs/debug/` for the before/after Airbus report

### Acceptance

- The incident is reproduced by a deterministic test.
- Baseline counts and issue distribution are recorded before behavior changes.
- Tests state exactly which fields are required for each audience combination.

## Phase 1 — Evaluate evidence per field

### Work

1. Introduce a pure evidence evaluator that returns:
   - exact valid citations;
   - invalid citations with field, evidence ID, and reason;
   - valid citations grouped by `audience`, `ata`, and `qrh`.
2. In the inherited aviation path:
   - keep aircraft and audience authoritative from document metadata;
   - accept ATA only when maintenance is required and at least one exact ATA
     citation supports the selected registered chapter;
   - accept QRH only when pilot is required and at least one exact QRH citation
     supports the selected registered target;
   - discard and audit invalid or inapplicable extra citations;
   - block only a required placement field that has no valid evidence.
3. Apply the same required-field rule to the non-inherited evaluator without
   removing its audience-evidence requirement where audience is actually being
   classified.
4. Add non-blocking `warnings` or `discardedEvidence` diagnostics to the result.
   Do not place them in the blocking `issues` array.
5. Keep exact substring matching, evidence ID matching, registry validation,
   model ambiguity, and source/registry fingerprint checks unchanged.

### Likely files

- `apps/web/src/lib/knowledge/efb-classification-policy.ts`
- `apps/web/src/lib/knowledge/efb-classification.ts`
- `apps/web/src/lib/knowledge/efb-classification-core.ts` or a new small
  `efb-classification-evidence.ts`
- Corresponding unit and integration tests

### Tests

- Valid QRH citation plus invalid inherited-audience citation is ready with a
  warning.
- Valid QRH citation plus invalid extra QRH citation is ready with discarded
  evidence recorded.
- Invalid-only QRH evidence remains non-ready.
- Pilot content cannot become ready from an ATA citation.
- Maintenance content cannot become ready from a QRH citation.
- Dual-audience content requires valid evidence for both placements.
- Unsupported target, explicit ambiguity, stale inputs, and registry mismatch
  remain non-ready.

### Acceptance

- Every accepted placement claim has exact source evidence.
- Unsupported evidence never changes stored metadata.
- An unused invalid quotation cannot invalidate a separately grounded required
  field.
- The checklist fixture resolves to `a320 / pilot / procedures / ready`.

## Phase 2 — Add one bounded quote-repair attempt

### Work

1. Trigger repair only when the model selected a registered required placement
   but supplied no exact citation for that field.
2. Send a minimal repair prompt containing:
   - the fixed selected field and value;
   - bounded source evidence IDs and text;
   - an instruction to return one exact contiguous quotation or report none.
3. Do not allow repair to change aircraft, audience, ATA/QRH target, or article
   content.
4. Validate repaired evidence through the Phase 1 pure evaluator.
5. Permit one repair call per classification execution. If it fails, retain the
   original result, add a field-specific issue, and stop retrying for evidence
   quality. Provider/network failures continue through existing queue retry
   behavior.
6. Record repair attempted/succeeded, provider/model, and discarded quotations
   in classification diagnostics and stage logs.

### Tests

- A repair returning an exact quote makes the required field ready.
- A paraphrase fails exact validation.
- Repair cannot change the selected target.
- Repair runs at most once.
- Provider failure follows existing retry limits without duplicate decisions.

### Acceptance

- Exact matching is never weakened.
- A repair call cannot alter classification scope.
- Failed repair produces one precise review issue and does not block other
  articles in the batch.

## Phase 3 — Replace broad correction states

### Work

1. Create one shared presentation mapper from classification status/issues to:
   - `Metadata ready`;
   - `Classifying placement`;
   - `Choose QRH category`;
   - `Choose ATA chapter`;
   - `Fix source evidence`;
   - `Fix document applicability`;
   - `Registry changed`;
   - `Classification failed`.
2. Use it in the article library, article detail, and EFB selections summary.
3. Show inherited aircraft/audience separately from model-derived placement.
4. Show discarded-evidence diagnostics inside an audit detail, not as a primary
   correction task when required metadata is ready.
5. Make retry available only for retryable non-ready states. Keep reviewed
   placement correction and its required reason unchanged.

### Likely files

- New `apps/web/src/lib/knowledge/efb-classification-presentation.ts`
- `apps/web/src/components/article-library.tsx`
- `apps/web/src/components/article-efb-classification.tsx`
- `apps/web/src/app/(app)/efb-selections/page.tsx`
- Page/view-model queries that currently collapse status to
  `needs_correction`

### Tests

- Every blocking issue maps to one stable user action.
- Internal underscore-delimited issue codes are not the primary UI message.
- Ready classifications with discarded evidence remain `Metadata ready`.
- Queued and running decisions are visibly distinct from correction work.

### Acceptance

- A reviewer can identify the unresolved field without opening database or job
  records.
- Aggregate counts distinguish active processing from review work.

## Phase 4 — Harden zero-input orchestration and recovery

### Work

1. Preserve the existing extraction-completion trigger in
   `runProductionExtractionJob`; do not add a second trigger.
2. Make `createKnowledgeAuthoringRunAfterExtraction` idempotent for worker
   retries. First verify whether extraction job state already prevents duplicate
   calls. If it does not, reuse an equivalent active/current run under a
   transaction rather than introducing a parallel run.
3. Verify eligibility before creation:
   - document exists in the workspace;
   - document is assigned to an active bundle with an active profile;
   - extracted pages are complete/readable;
   - authoring automation is enabled by the profile.
4. Keep `awaiting_provider` and `awaiting_cost_confirmation` explicit. They do
   not become metadata-review states and must not trigger repeated model calls.
5. Ensure both article-creation paths invoke inherited classification exactly
   once per immutable revision and queue placement only when required.
6. Extend recovery to locate:
   - completed eligible extractions with no authoring run;
   - approved/enriched legacy topics with no article revision;
   - approved revisions with no current classification;
   - retryable classifications that never reached a terminal state.
7. Reuse existing worker reconciliation and `backfillEditorial`; add narrow
   reconciliation functions only for missing cases.

### Likely files

- `apps/web/src/lib/production-worker.ts`
- `apps/web/src/lib/production-repository.ts`
- `apps/web/src/worker/extraction-worker.ts`
- `apps/web/src/lib/knowledge-authoring.ts`
- `apps/web/src/lib/knowledge/editorial.ts`
- `apps/web/src/lib/knowledge/efb-classification-queue.ts`

### Tests

- Extraction completion automatically creates and enqueues authoring.
- Retrying extraction completion does not create duplicate current runs.
- Unassigned/inactive-bundle documents do not start authoring.
- Unreadable extraction does not start authoring.
- Missing provider and cost confirmation stop in their explicit states.
- Article creation inherits metadata and queues at most one placement decision.
- Recovery is idempotent and workspace-scoped.

### Acceptance

- An eligible extraction proceeds into authoring without a metadata action.
- Repeated workers and recovery passes do not duplicate model work.
- One ambiguous article does not stop other articles from reaching ready.

## Phase 5 — Add operational metrics

### Work

1. Build a read-only aggregation service over existing records. Do not add a
   new analytics table for the proof of concept.
2. Report per workspace/bundle/document:
   - authoring stage and waiting reason;
   - articles classified deterministically;
   - articles classified by model;
   - quote repairs attempted/succeeded;
   - ready, queued/running, needs-review, blocked, and failed counts;
   - issue counts by field/reason;
   - approved, selected, exported, published, and activated counts.
3. Add a compact workflow/status panel and a machine-readable debug report.
4. Never expose prompts, keys, or full source text in aggregate telemetry.

### Acceptance

- The Airbus document can be evaluated from one report.
- Before/after `invalid_evidence_quote` counts are visible.
- Provider/cost waits are separate from metadata-quality failures.

## Phase 6 — Controlled rollout

### Verification sequence

1. Run unit tests for evidence, repair, presentation, and orchestration.
2. Run the existing six-topic controlled fixture set: two 737 NG, two 737 MAX,
   and two A319/A320 topics.
3. Backfill and reclassify the processed Airbus QRH without re-extracting the
   PDF or recreating approved articles.
4. Compare the 88-article baseline with the new result:
   - no regression in exact-evidence or registry validation;
   - fewer false correction states;
   - genuine ambiguity remains reviewable;
   - ready selections and active packages remain unchanged until explicitly
     rebuilt/published/activated.
5. Build one signed candidate package from ready Airbus articles and run package
   validation without activating it.
6. Run the repository validation suite.

### Required repository checks

```bash
pnpm --dir apps/web lint
pnpm --dir apps/web test
pnpm --dir apps/web build
python3 -m unittest tests/test_okf_relation_lint.py
python3 tools/okf_relation_lint.py --manifest okf-base.yaml
```

### Release gates

- No automatic approval was introduced.
- No reviewed EFB selection was overwritten.
- No package was published or activated implicitly.
- Every ready applicability/placement claim is registry-valid and evidence
  bound.
- Recovery and worker retries are idempotent and workspace-scoped.
- The Airbus checklist and fixture matrix pass.

## Delivery units

Keep review and rollback simple by landing the work as four independently
reviewable changes:

1. Field-level evidence evaluation and quote repair.
2. Field-specific UI states.
3. Orchestration/recovery hardening.
4. Metrics, Airbus backfill evaluation, and documentation.

Each delivery updates the changelog and this roadmap with actual verification
evidence. Do not begin the next delivery until its tests and acceptance criteria
pass.

## Expected result

For an eligible, sufficiently grounded aviation PDF, the ordinary user journey
becomes:

```text
Upload file
  -> extraction completes
  -> authoring and metadata discovery start automatically
  -> articles inherit aircraft/audience/provenance automatically
  -> ATA/QRH placement resolves automatically
  -> ambiguous records are isolated with precise reasons
  -> approved ready revisions become package candidates under existing policy
```

The bulk metadata action remains only for recovery and old data. The system does
not ask the user to classify metadata during the normal path.

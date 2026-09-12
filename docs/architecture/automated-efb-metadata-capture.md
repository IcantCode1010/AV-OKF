# Automated EFB metadata capture

Status: proposed refinement after the Airbus QRH classification incident on
2026-09-10.

Concrete delivery plan: [Automated EFB Metadata Capture Implementation Plan](../roadmap/automated-efb-metadata-capture-implementation-plan.md).

## Problem

An approved article titled `Normal operations checklist` appeared as **Needs
correction** even though its source and destination were clear. The article was
derived from page 155 of the Airbus A319/A320 QRH. Document metadata already
established the `a320` educational aircraft family and `pilot` audience, and the
article belonged in the registered `procedures` QRH target.

The model selected that placement correctly, but it also returned an additional
quotation that was not an exact substring of the source evidence. The evidence
validator correctly refused that quotation and changed the entire result to
`needs_review` with `invalid_evidence_quote`. The UI summarized this as **Needs
correction**, which made a mostly correct record look as if all EFB metadata were
missing.

The incident exposed two broader workflow problems:

1. Document-level aircraft and audience metadata was copied into article
   revisions, but article-specific ATA or QRH classification was not always
   queued automatically.
2. The model was asked to re-explain inherited facts. Extra audience or
   inapplicable placement citations could invalidate an otherwise grounded
   article placement.

The source PDF, extraction, topic, and article did not need to be regenerated.
The failure occurred only in the EFB metadata decision attached to the approved
article revision.

## Current behavior after the immediate fix

- Approved aviation articles inherit aircraft applicability and audience from
  their source documents.
- If a source document allows several ATA chapters or QRH targets, the workflow
  queues article-level placement classification.
- For inherited aviation metadata, the model is instructed to return the
  supplied audience unchanged and determine only the applicable ATA or QRH
  placement.
- Placement evidence must be an exact, contiguous quotation associated with a
  supplied page evidence ID.
- An explicit rerun refreshes `needs_review`, `failed`, or `cancelled` model
  decisions. It does not replace a `ready` decision or invalidate unrelated
  package selections.
- The checklist now resolves to `a320` / `pilot` / `procedures` with exact page
  155 evidence and has status `ready`.

## Metadata worth capturing

The system should capture metadata that changes retrieval, navigation,
traceability, review, or export behavior. It should avoid descriptive tags that
have no defined consumer.

### Required source and provenance metadata

Capture once from the document and retain it on every derived revision:

- source document ID, title, revision, authority, and document type;
- exact source page numbers and evidence IDs;
- source content fingerprint;
- aircraft family applicability;
- audience (`pilot`, `maintenance`, or both);
- applicability scope, status, confidence, and supporting evidence;
- source effectivity when the document states it unambiguously.

### Required article and EFB metadata

Capture or derive for each immutable approved article revision:

- stable article ID and revision version;
- title and concise purpose/summary;
- aircraft family inherited from the source;
- audience inherited from the source;
- exactly one registered ATA chapter for maintenance content, when applicable;
- exactly one registered QRH target for pilot content, when applicable;
- exact placement evidence and a short rationale;
- registry fingerprint, classification policy, provider/model, confidence,
  issues, and decision timestamp;
- approval state and whether the decision was automatic or reviewed;
- package-selection and export eligibility state.

### Useful optional metadata

Only capture these when explicit source evidence exists and a known consumer
uses them:

- effectivity or configuration limits;
- procedure type such as normal, abnormal, emergency, limitation, or reference;
- operational phase such as preflight, taxi, takeoff, cruise, approach, landing,
  or shutdown;
- system or component names used by graph and retrieval features;
- warnings, cautions, notes, prerequisites, and related procedures;
- approved relationships to other OKF topics;
- supporting visual references and their page provenance.

Optional values must never be guessed to make a record look complete. Missing
optional metadata does not block export unless the Project EFB registry or
package contract declares it required.

## Streamlined target workflow

```text
Upload PDF
  -> extract pages and preserve page provenance
  -> classify document once
       aircraft + audience + document type + allowed placement scope
  -> create article candidates
  -> enrich article content and propose optional metadata in the same model call
  -> validate every proposed value against the Project EFB registry and source
  -> approve an immutable article revision
  -> inherit authoritative document metadata automatically
  -> resolve article-specific ATA/QRH placement automatically
  -> automatically select only fully validated revisions
  -> build, validate, sign, publish, and explicitly activate the OKF package
```

The user should not have to run a second general metadata preparation step.
Article approval should trigger the bounded classification job. Bulk preparation
remains a recovery and backfill operation for older records.

## Decision rules

Use the cheapest trustworthy source for each field:

1. **Deterministic inheritance:** source identity, aircraft, audience, document
   type, page provenance, and explicit single-value placement.
2. **Deterministic extraction:** explicit ATA codes, revision/effectivity text,
   page headings, and controlled terms that match a registered value.
3. **Bounded model classification:** article-specific placement and useful
   optional metadata when deterministic evidence is insufficient.
4. **Editorial review:** conflicting sources, several plausible registered
   placements, missing exact evidence, unsupported registry values, or explicit
   model ambiguity.

The model may select only values from the versioned Project EFB registry. Every
field that affects placement or applicability must record exact evidence. A
model may omit an optional field; it may not manufacture one.

## Status and interface behavior

Replace the broad **Needs correction** summary with the most specific state:

- **Metadata ready**: all required fields and evidence validate.
- **Classifying placement**: an article-level job is queued or running.
- **Choose QRH category** or **Choose ATA chapter**: placement is unresolved.
- **Fix source evidence**: the proposed value lacks an exact source quotation.
- **Fix document applicability**: aircraft or audience metadata is unresolved.
- **Registry changed**: the saved decision no longer matches the active registry.

The article detail should show inherited fields separately from model-derived
fields and identify the exact field requiring attention. Review should edit only
the unresolved field and require a reason, preserving the original model result
in the audit trail.

## Implementation plan

### Phase 1: unify metadata production

- Define one typed `ArticleEfbMetadata` contract shared by article creation,
  classification, selection, and export.
- Map every field to its authority: document, deterministic extractor, model,
  reviewer, or package builder.
- Remove duplicate metadata aliases from generated article bodies after a
  compatibility migration or adapter is in place.

### Phase 2: classify during article creation and approval

- Generate optional article metadata alongside article enrichment so the model
  reads the source once.
- Treat those values as proposals until the immutable article revision is
  approved.
- On approval, inherit document metadata and validate/reuse the proposed
  placement when its source fingerprint and registry fingerprint remain current.
- Queue a separate placement call only when the proposal is absent, stale, or
  invalid.

### Phase 3: precise validation and recovery

- Validate each metadata field independently and store field-level issues.
- Add a bounded exact-quote repair attempt before editorial review, without
  relaxing evidence matching.
- Allow explicit reruns of non-ready decisions while keeping ready decisions
  immutable.
- Present field-specific correction controls and batch retry for the same issue
  type.

### Phase 4: automatic package readiness

- Automatically select approved, current, metadata-ready revisions when the
  workspace enables automatic selection.
- Keep publication and activation as explicit existing boundaries.
- Report counts for inherited, model-classified, repaired, reviewed, blocked,
  selected, exported, published, and activated records.

## Acceptance criteria

- A new aviation article reaches `Metadata ready` after approval without a
  second manual preparation action when its evidence is sufficient.
- Document-level metadata is never reclassified by the article model.
- ATA/QRH placement uses only active registry IDs and exact page evidence.
- Invalid optional metadata cannot invalidate otherwise correct required
  metadata; it is omitted and audited instead.
- The UI identifies the exact unresolved field and corrective action.
- Rerunning a non-ready decision cannot alter ready decisions or active package
  state.
- Existing approval, EFB selection, signed export, publication, and activation
  boundaries remain enforced.
- Tests cover a single-category maintenance document, a multi-category QRH, a
  dual-audience source, exact-quote repair, genuine ambiguity, registry changes,
  and revision/source staleness.

## Open questions for independent review

1. Should article enrichment and metadata proposal share one model call, or does
   that couple content quality and navigation classification too tightly?
2. Which optional metadata has a concrete consumer in Project EFB today?
3. Should one valid exact placement citation be sufficient when extra model
   citations are invalid, or should any fabricated quotation continue to fail
   the entire decision?
4. What retry and cost limits should apply to exact-quote repair and placement
   classification?
5. Should automatic selection be enabled by default for a proof of concept, or
   remain a workspace setting?

## Independent Claude council review

Reviewed read-only against the current checkout on 2026-09-10.

### Verdict

Approve the diagnosis and guardrails, but reduce the implementation scope. The
council recommends fixing evidence evaluation and correction-state clarity
before unifying metadata contracts. It recommends keeping article enrichment
and placement classification as separate model calls.

### Findings

- **High:** The immediate prompt change reduces extra quotations but does not
  structurally solve partial citation failure. In the inherited path,
  `processClassification` still changes the entire decision to `needs_review`
  when any returned quotation is invalid, even if the citation used for the
  selected placement is exact. Validation should operate per claimed field:
  retain exact citations, discard and audit invalid citations, and block a
  required field only when that field has no valid supporting citation.
- **Medium:** The UI still groups every non-ready result under **Needs
  correction** and renders internal issue codes on article details. It should
  name the unresolved field and the action required.
- **Medium:** Three metadata shapes currently coexist: snake-case
  `okfMetadata`, camel-case classification metadata, and the export selection
  schema. A shared type would remove real duplication, but should initially
  unify existing fields rather than add new ones.
- **Medium:** Automatic selection is a deployment-wide environment flag, not a
  workspace setting. A workspace control would require new persistence and UI
  and is unnecessary for the proof of concept.
- **Medium:** Article generation/enrichment and EFB classification have separate
  retry and audit behavior today. Combining them would couple content-quality
  failures with navigation failures.

### Council answers

1. Keep article enrichment and placement classification separate unless
   measured cost or latency later proves the second call is a bottleneck.
2. Do not add the optional metadata fields yet; the current codebase has no
   confirmed consumer for them.
3. One valid exact citation should support its specific placement field. An
   invalid extra citation should be discarded and audited, and should block
   only a required field that has no valid evidence.
4. Allow one bounded exact-quote repair attempt and record it using the existing
   classification attempt/audit machinery. Add configuration only after usage
   data shows a need.
5. Keep the existing deployment flag for automatic selection during the proof
   of concept. Defer a workspace setting.

### Revised implementation order

1. Implement field-level evidence evaluation and one bounded exact-quote repair
   attempt without relaxing exact matching for any accepted metadata claim.
2. Replace broad correction labels and raw issue codes with field-specific
   states and actions.
3. Unify only the existing document, classification, selection, and export
   metadata shapes behind one typed contract and compatibility adapters.
4. Measure remaining correction rate, classification cost, and latency before
   considering optional metadata, merged model calls, or workspace-level
   automatic-selection controls.

This order does not modify article approval, reviewed-selection locks, signed
publication, or explicit activation boundaries.

## Council follow-up: zero-input capture during ingestion and creation

The council reviewed the narrower requirement that metadata capture itself must
require no user input. Most of the necessary pipeline is already present. Two
gaps prevent reliable zero-input behavior: extraction does not automatically
create the authoring run, and evidence validation still treats one unused
invalid quotation as failure of the whole classification decision.

### Automatic lifecycle

#### Upload

- Store the original document, bundle association, source type, and immutable
  source identity.
- Do not ask for EFB classification fields at upload.
- Use the assigned bundle and aviation source type to decide whether EFB
  authoring applies.

#### Extraction completion

- Automatically create and enqueue one idempotent `KnowledgeAuthoringRun` for
  an aviation document assigned to a bundle.
- Run the existing stages: `metadata_discovery`,
  `applicability_classification`, `concept_discovery`, `full_rag_index`,
  `media_discovery`, `enrichment`, `efb_classification`,
  `relation_classification`, and `validation`.
- Resume after interruption from the recorded completed stages.
- Keep provider-availability and explicit cost-confirmation gates. They are
  infrastructure and spending controls rather than metadata questions.

#### Document metadata discovery

- Use the bounded metadata model to propose title, description, tags, subject
  family, document type, classification code, revision, effectivity, source
  authority, audiences, source classification, license, and content purpose.
- Never overwrite a trusted existing value.
- Keep an ATA or QRH document-scope value only when it is registered and its
  proposed quotation exactly matches extracted page text.
- Run aircraft applicability separately because it has its own deterministic
  normalization, confidence threshold, and permanent manual-override boundary.

#### Article creation

- Create an immutable article revision from the approved or enriched topic.
- Automatically inherit aircraft, audience, source identity, page evidence,
  fingerprints, revision, authority, and effectivity.
- Resolve ATA/QRH placement deterministically when document scope contains one
  valid value.
- Queue the bounded placement classifier only for multi-category documents.
- Keep article enrichment and placement classification as separate calls
  because they have different retry, validation, and audit behavior.

#### Article approval

- Revalidate source and registry fingerprints.
- Preserve explicit article approval.
- When deployment-wide automatic selection is enabled, select only an approved,
  current, `ready` article revision. Never replace a reviewed selection.

#### Package preparation

- Reconcile missing inherited metadata and queue missing placement jobs as a
  recovery operation.
- Automatically include only approved, selected, registry-valid revisions.
- Preserve explicit publication and activation boundaries.

### Zero-input ambiguity behavior

Zero input does not mean guessing. A genuinely ambiguous record remains
`needs_review` or `blocked`, is excluded from automatic selection, and does not
stop unrelated valid articles. The system records a precise field-level reason
and continues the batch. It does not show a metadata question during ingestion.

### Structural evidence correction

- A required ATA or QRH field becomes ready only through a deterministic
  single-value scope or at least one exact source citation for that field.
- Invalid citations are discarded and recorded in diagnostics.
- An invalid citation blocks only the field it was intended to support when no
  valid citation for that field remains.
- Invalid evidence for inherited or inapplicable fields does not invalidate a
  separately grounded placement.
- One bounded exact-quote repair attempt is allowed for a required placement
  field. Exact matching is never relaxed.

### Persistence and observability

Use existing persistence instead of adding another metadata system:

- `Document` stores source and document-scope metadata.
- `KnowledgeAuthoringRun` stores resumable stages and audit.
- `KnowledgeArticleRevision` stores the immutable article and provenance.
- `KnowledgeEfbClassification` stores the input- and registry-fingerprinted
  decision, evidence, issues, provider, and model.
- `KnowledgeEfbClassificationDecision` stores reviewed corrections.
- `KnowledgeEfbSelection` and release records preserve package boundaries.

Aggregate these records to report inherited, model-classified, repaired,
blocked, selected, exported, published, and activated counts. Initially measure
the percentage reaching `ready` with no second action, the count blocked by
`invalid_evidence_quote`, and runs waiting for a provider or cost confirmation.

### Council-recommended delivery order

1. Implement field-level evidence evaluation and one bounded quote-repair
   attempt.
2. Automatically create the authoring run when extraction completes for an
   eligible aviation document.
3. Extend the editorial backfill to start missing authoring runs for eligible
   older documents.
4. Add aggregate pipeline metrics using existing tables.
5. Defer new optional metadata, merged model calls, and workspace-level
   automatic-selection settings until usage establishes a consumer or
   bottleneck.

# Change proposal: Unified OKF Release Pipeline (PoC)

## Objective

Deliver a single, resumable release pipeline that carries reviewed knowledge from
source upload through an **activated** entry in Project EFB's existing catalog:
upload → extract/index → topic discovery → immutable article revision →
deterministic aircraft/ATA/QRH classification against the versioned Project EFB
registry → human review/approval → profile-driven root/hub navigation
compilation → one signed, checksummed OKF package → publish to Project EFB's
*existing* Supabase receiver → explicit activation → available to Project EFB's
own agent runtime.

This is a consolidation-first milestone, not a green-field build. Most of the
pipeline already exists but is split across two disconnected orchestration
stacks, two classifier implementations, and one entirely missing stage
(navigation-graph generation and any publisher at all). The proof-of-concept
uses the retrieval strategy already implemented (`retrieval.jsonl`,
`strategy: "structured-keyword"`) — no vector/hybrid retrieval work is in
scope, and building the answer-generation agent itself is explicitly Project
EFB's responsibility, not AV-OKF's.

## Acceptance criteria

- [ ] A curator can take a source document for each of 737NG, 737MAX, and
      A319/A320 content through one traceable, resumable release-run record —
      from approved article revision to an **activated** Project EFB catalog
      entry — using a single orchestration model, not two.
- [ ] Every published entry originated from a `KnowledgeArticleRevision`; no
      release path can publish content that bypassed article-revision review.
- [ ] Exactly one classifier implementation produces
      `KnowledgeEfbClassification` rows against exactly one loaded copy of
      `project-efb-knowledge-registry.v1.json` per run.
- [ ] A compiled package contains a declared navigation root, its hubs, and
      100% article reachability from that root — verifiable by a machine-
      readable navigation report, not just an aggregate article count.
- [ ] A validated package can be uploaded, imported, and activated through
      Project EFB's actual deployed `POST /api/publish` contract and its
      receiver tables — `okf_packages`, `okf_entries`, `okf_links`,
      `okf_sources`, `okf_releases`, `okf_release_packages`, `okf_catalog`,
      `okf_artifacts`, `okf_assets`, `okf_retrieval_documents`, plus the
      `okf_withdrawals`/`okf_publishers`/`okf_assignments` support tables and
      the `retrieval_builds`/`retrieval_chunks`/`retrieval_embeddings`
      retrieval-index tables (16 tables total, verified 2026-09-09 against
      the current Project EFB-MX checkout) — without creating any
      new/parallel table and without any direct table/RPC access that
      bypasses the HTTP contract.
- [ ] Rollback restores the previous active package version with zero data
      loss and without re-uploading or re-importing it.
- [ ] (Decision resolved.) Automated acceptance runs six controlled,
      source-grounded fixture documents — two each for 737-ng, 737-max, and
      a320 — through the full pipeline end to end in one documented,
      repeatable verification run, independent of curator document
      availability.
- [ ] (Decision resolved.) Before general rollout, the same pipeline is
      additionally exercised once against real curator-selected source
      documents per aircraft family, as the final rollout check — a
      supplementary gate that runs after and in addition to the six-fixture
      automated run above, never a replacement for it.
- [ ] `pnpm --dir apps/web test`, `pnpm --dir apps/web lint`,
      `pnpm --dir apps/web build`, and
      `python tools/okf_relation_lint.py --manifest okf-base.yaml` all pass
      with no new failures beyond the recorded baseline.

## Current implementation

### What already works (evidence-backed, do not rebuild)

- **Retrieval strategy already matches the requested PoC scope.** In
  `apps/web/src/lib/efb-release-export.ts::exportEfbRelease`, `release.json`
  already declares `retrieval: { strategy: "structured-keyword", ... }`, and
  the [Project EFB package acceptance contract](../../docs/architecture/project-efb-package-acceptance-contract.md)
  states embeddings are explicitly *Project EFB's* derived, replaceable
  responsibility, never part of the AV-OKF package. No work is needed here
  beyond not regressing it.
- **One registry, already shared.** `apps/web/src/lib/project-efb-contract-registry.ts::loadProjectEfbContractRegistry`
  is the single loader for `contracts/registries/project-efb-knowledge-registry.v1.json`
  from `PROJECT_EFB_ROOT`, and both classification stacks (below) already call
  it. This part of "one registry... authoritative" is done.
- **One low-level signed exporter, already shared.** `apps/web/src/lib/efb-release-export.ts::exportEfbRelease`
  is the single function that builds `manifest.json`/`display/`/`agent/`/`retrieval.jsonl`/
  checksums/signature, and both orchestration stacks below call it. The
  immutable-package *builder* is already unified; what is duplicated is
  everything that decides what gets fed into it.
- **Aircraft applicability already covers all three required families.**
  `apps/web/src/lib/knowledge/efb-classification-core.ts` and
  `automatic-efb-classification-and-bulk-export.md` (2026-09-09 entries)
  confirm `737-ng`, `737-max`, and `a320` (covering A319/A320) are live,
  registry-validated classification targets today.
- **Article revisions are already trending toward "sole publishable path."**
  `apps/web/src/lib/knowledge/editorial.ts::importLegacyTopic` and
  `::importBuilderRevision` already bridge both the document-driven aviation
  `TopicRecord` path and the `TopicBuilderRun` path into
  `KnowledgeArticleRevision`, and `backfillEditorial` runs both bridges. This
  is the mechanism to build on, not replace.

### What is duplicated (confirmed by reading the code, not just docs)

Two independent orchestration stacks exist end to end, both terminating in the
same `exportEfbRelease` call but never sharing state, status values, or
classification results:

**Stack A — legacy automatic PoC, `TopicRecord`-direct:**
`apps/web/src/lib/efb-release-automation.ts` (`createAutomaticPocEfbReleaseJob`,
`runPocEfbReleaseJob`, `reconcilePocEfbReleaseJobs`) is driven by the
`EfbReleaseJob` Prisma model (`apps/web/prisma/schema.prisma:1034`, keyed to
`KnowledgeAuthoringRun`, status `queued|running|completed|failed`). It fires
automatically whenever a `KnowledgeAuthoringRun` reaches `ready_for_review`
for an aviation document, reads `TopicRecord` rows directly (`loadPocTopics`),
and classifies them through
`apps/web/src/lib/project-efb-article-classification.ts::classifyProjectEfbArticle`,
storing results in `TopicRecord.okfMetadata.extensions.projectEfb`. Export
mode is `"poc"` (unsigned, legacy schema 2.0).

**Stack B — explicit selection, article-revision-based:**
`apps/web/src/lib/knowledge/workflow.ts::executeEditorialAction` (actions
`select`, `prepare-and-export-efb`, `export`) and
`apps/web/src/lib/knowledge/export.ts::exportSelectedArticles` are driven by
the `KnowledgeExportRelease` Prisma model (`schema.prisma:1907`, status
`draft|queued|validating|exported|failed|cancelled|validation_failed`) plus
`KnowledgeEfbSelection` (`schema.prisma:1896`). It classifies through
`apps/web/src/lib/knowledge/efb-classification.ts` /
`efb-classification-core.ts` / `efb-classification-policy.ts` /
`efb-inherited-metadata.ts`, storing results in the separate
`KnowledgeEfbClassification` Prisma model (`schema.prisma:1854`). Export mode
is `"poc-local"` or `"poc-cloud"` (signed schema 2.1).

These are genuinely different classifiers (different prompts, different
evidence-citation rules, different output persistence) reading the *same*
registry, and genuinely different job/status machines for the *same*
destination. `KnowledgeAuthoringRun` (`schema.prisma:443`, document ingestion
stages) and `TopicBuilderRun` (`schema.prisma:31`, Topic Builder stages) are
two more independent upstream state machines feeding both stacks. This is
exactly the "disconnected status flows" and duplicated-decision-authority
problem named in the objective — confirmed in code, not assumed.

### Navigation compiler: only Phase A exists

`apps/web/src/lib/navigation/profile-schema.ts` and `load-profile.ts` (schema
validation + safe versioned YAML loading) are implemented and tested, backed
by `apps/web/config/navigation/737-flight-controls.v1.yaml`. Nothing else
from [Modular OKF Navigation Compiler Requirements](../../docs/architecture/modular-okf-navigation-compiler-requirements.md)
exists: no `classify-membership.ts`, `generate-root.ts`, `generate-hubs.ts`,
`generate-navigation-links.ts`, `compile-relations.ts`, `validate-graph.ts`,
or `report-navigation.ts` (confirmed: zero matches for those symbols anywhere
under `apps/web/src`). `docs/architecture/efb-publisher-contract-status.md`'s
2026-09-08 inventory of the current live package confirms this in practice:
79 articles, 79 ATA:27 placements, but **no identifiable root entry and no
established reachability** — the package has no navigation graph today.

### Publisher: nothing exists (AV-OKF side); Project EFB's receiver contract re-verified 2026-09-09

No `apps/web/src/lib/efb-publisher/` directory, no `publish:efb` pnpm script,
and no code targeting Supabase Storage or Postgres at all on the AV-OKF side.
The originally proposed schema in `docs/roadmap/efb-publisher-phased-plan.md`
Phase 1 (`okf_packages`, `okf_articles`, `okf_placements`,
`okf_article_links`, `okf_article_sources`, `okf_active_packages`, an
`okf-packages` bucket) remains explicitly superseded. This proposal goes
further than the prior, now-stale 2026-09-08 receiver-compatibility note: it
independently re-reads Project EFB's *current* checkout
(`C:\projects\Project-EFB-MX`) directly — not the 2026-09-08 note's summary of
an earlier state — and finds the receiver contract is both larger and shaped
differently than that note described:

- **Framework**: Project EFB-MX is a Vite + React 18 SPA deployed on Vercel,
  not Next.js. There is no broad REST surface; exactly one HTTP endpoint
  matters for publishing: `POST /api/publish` (`api/publish.ts`, a Vercel
  serverless function, single action-dispatch handler, 4 MB request-body cap,
  `maxDuration: 180`). A CLI wrapper already exists on Project EFB's side,
  `scripts/publish-knowledge.mjs`, which POSTs to `EFB_PUBLISHER_URL` with an
  `Authorization: Bearer` token — the shape AV-OKF's own publisher module
  should replicate or shell out to.
- **Receiver tables**: 16, not 6 — `okf_packages`, `okf_assignments`,
  `okf_entries`, `okf_links`, `okf_releases`, `okf_release_packages`,
  `okf_catalog` (a singleton active-pointer row), `okf_withdrawals`,
  `okf_publishers`, `okf_sources`, `okf_artifacts`, `okf_assets`,
  `okf_retrieval_documents`, `retrieval_builds`, `retrieval_chunks`,
  `retrieval_embeddings`. All have RLS enabled with zero policies and all
  direct grants revoked from `anon`/`authenticated` — the only access paths
  are `SECURITY DEFINER` functions or Project EFB's own service-role key.
  Sourced across 7 migrations, not the 4 previously cited:
  `20260904000300_okf_catalog.sql`, `20260904000500_okf_evidence.sql`,
  `20260904000800_catalog_browsing.sql`, `20260904000900_okf_publication.sql`,
  `20260905000100_link_evidence_and_assignments.sql`,
  `20260905000300_published_assets.sql`, `20260907000100_vector_storage.sql`.
- **No single transactional "import" RPC.** Ingest is a resumable, multi-step
  action saga orchestrated by Project EFB's own `Publisher` class
  (`server/publication.ts`), driven through `/api/publish` actions:
  `initialize` (registers `okf_packages` + `okf_artifacts`) → `upload`
  (per-artifact Supabase Storage signed PUT URL against bucket
  `okf-artifacts`, object key `{artifact_prefix}/{artifactPath}`) →
  `validate` (downloads/checksums each artifact, upserts `okf_entries` /
  `okf_sources` / `okf_links`, marks `okf_artifacts.verified`) → `complete`
  (writes `okf_retrieval_documents` / `okf_assets`, then calls RPC
  `complete_okf_package`, grant restricted to `service_role` only — even an
  authorized external publisher cannot call this step directly) → `prepare`
  (RPC `prepare_okf_release`: rejects duplicate `package_id`s and unresolved
  cross-package links, creates an `okf_releases` candidate) → `activate`
  (RPC `activate_okf_release`: a pure `okf_catalog.release_id` pointer flip —
  no content is copied or re-imported).
- **Authorization is two-factor, both external to AV-OKF's own codebase**:
  (1) a Bearer JWT for a real, signed-in Project EFB user account already
  holding an *enabled* row in `okf_publishers` — there is no self-service
  enrollment endpoint; only Project EFB's own admin-only scripts can grant
  this, so AV-OKF's publisher identity must be provisioned out-of-band by a
  Project EFB administrator before Stage 6 can run against any real
  environment; and (2) a detached Ed25519 signature over the manifest,
  verified against a public key that must already be listed in Project EFB's
  `EFB_OKF_TRUSTED_KEYS` — AV-OKF's signing keypair must be exchanged with,
  and trusted by, Project EFB beforehand, independent of the JWT/role check.
  Neither requirement was documented in the prior contract-status note.
- **Rollback is the identical `activate` action, pointed at an older,
  still-`retained` release id** — confirmed at both the RPC level and the CLI
  wrapper level (`scripts/publish-knowledge.mjs` maps its `rollback` command
  to `action: 'activate'`). There is no separate rollback endpoint and no
  content re-copy, confirming (not merely assuming) this proposal's
  pointer-flip-only rollback requirement below.
- **Package schema matches what AV-OKF already produces.** Project EFB's
  runtime Zod schema (`server/publication.ts:14-22`) requires
  `schemaVersion: '2.1'` literal, `format.name: 'open-knowledge-format'`,
  sha256 checksum, ed25519 signature — the same shape
  `apps/web/src/lib/efb-release-export.ts` already emits for `poc-cloud`
  mode. The registry Project EFB validates against is the same file AV-OKF
  already loads (`contracts/registries/project-efb-knowledge-registry.v1.json`),
  confirming no registry drift.

This supersedes `docs/architecture/efb-publisher-contract-status.md`'s
2026-09-08 entry outright. That document's own instruction — "stop and report
the incompatibility instead of guessing" if the contract changed again — is
exactly what this re-verification did; Stage 1 below now formalizes
transcribing these already-confirmed findings into that document rather than
performing first-time discovery during implementation.

## Confirmed problems

1. Two independent classifier implementations produce EFB classification
   decisions against the same registry, with no shared source of truth
   between `TopicRecord.okfMetadata.extensions.projectEfb` and
   `KnowledgeEfbClassification` rows. (Confirmed by reading both files.)
2. Two independent release-orchestration state machines
   (`EfbReleaseJob`/`efb-release-automation.ts` vs.
   `KnowledgeExportRelease`/`knowledge/export.ts`) exist for the same
   destination, plus two further independent upstream state machines
   (`KnowledgeAuthoringRun`, `TopicBuilderRun`) feeding them. (Confirmed.)
3. No navigation-graph generation exists; the current live package has no
   declared root/hub structure or established reachability. (Confirmed by
   the receiver-compatibility review's own inventory.)
4. No publisher exists in any form; the only previously written publisher
   design targets a schema Project EFB does not actually run. (Confirmed:
   zero matching files/scripts, contract-status doc's explicit correction.)

## Not confirmed / requires product or external decision

- **Provisioning of AV-OKF's Project EFB publisher identity.** Which Project
  EFB user account will hold the enabled `okf_publishers` row, and the
  exchange of AV-OKF's Ed25519 signing keypair into Project EFB's
  `EFB_OKF_TRUSTED_KEYS`. Both are out-of-band administrative actions on
  Project EFB's side (no self-service enrollment path exists) and are
  external dependencies that must complete before Stage 6 can run against
  any real Project EFB environment — neither this proposal nor AV-OKF's
  codebase can resolve them unilaterally.
- **Selection of the real curator-selected source documents** used for the
  pre-rollout verification pass (Stage 7's supplementary final check, which
  runs after and in addition to the six controlled fixtures). Real content
  selection needs a curator, not this proposal.

## Recommended solution

Consolidate onto **Stack B's data model** (`KnowledgeArticleRevision` →
`KnowledgeEfbSelection` → package export) because it is already the
capability-complete side: it is the only stack with signed `poc-cloud`
export, the only one integrated with the shared editorial/visual-review
workflow, and the only one whose classification service
(`knowledge/efb-classification.ts`) already reconciles LLM output against
deterministic document-inherited metadata. Stack A's only unique behavior —
automatic firing on `KnowledgeAuthoringRun` completion — is re-implemented as
a trigger into Stack B's (new, unified) run model rather than kept as a
second parallel job type.

Concretely, in order of dependency:

1. **Unify classification.** Fold `project-efb-article-classification.ts`'s
   LLM-classification call (currently only used by Stack A) into
   `knowledge/efb-classification.ts` as its LLM-prediction path, or retire it
   in favor of `knowledge/efb-classification.ts` entirely once Stack A's
   `TopicRecord`s are bridged through `importLegacyTopic` (which already
   exists and already runs for every enriched aviation topic via
   `backfillEditorial`). Either way, `KnowledgeEfbClassification` becomes the
   only classification record type written by new code.
2. **Introduce one resumable release-run model.** This decision is resolved:
   add the new, additive `KnowledgeReleaseRun` model rather than extending
   `KnowledgeExportRelease` in place, because the export-specific model's
   `status` enum cannot cleanly absorb classification-gating and navigation
   stages without stretching its meaning (see Alternatives considered). Add
   the new Prisma model (working name `KnowledgeReleaseRun`) that tracks an ordered, idempotent
   stage sequence — reusing the proven `currentStage`/`completedStages`
   pattern already used by `KnowledgeAuthoringRun`
   (`schema.prisma:443-468`) rather than inventing a new resumability idiom.
   Stages: `gate_selection` → `classify` → `compile_navigation` →
   `build_package` → `upload` → `import` → `verify` → `activate`. Port
   `exportSelectedArticles`'s existing preflight/export logic into this run
   as stages rather than rewriting it from scratch.
3. **Redirect Stack A (decision resolved: redirect, not retire).**
   `efb-release-automation.ts`'s `createAutomaticPocEfbReleaseJob` stops
   creating `EfbReleaseJob` rows and instead creates a `KnowledgeReleaseRun`,
   kept behind the existing `AV_OKF_EFB_EXPORT_MODE` flag for one full release
   cycle after Stage 7's verification is clean. Historical `EfbReleaseJob`
   rows are preserved, read-only, for that entire cycle and are never deleted
   or rewritten by this milestone — history is fully retained; outright
   removal of the old `EfbReleaseJob` write path is a separate, later
   follow-up, scheduled only after that cycle's clean end-to-end verification
   — not part of this milestone. No code path may construct an
   `EfbReleaseSourceEntry` directly from `TopicRecord` outside the
   `KnowledgeArticleRevision` bridge after this stage.
4. **Build navigation compiler Phases B–F** exactly as scoped in
   `docs/architecture/modular-okf-navigation-compiler-requirements.md`,
   wired in as the `compile_navigation` stage of the new run, operating on
   the set of `KnowledgeArticleRevision`s selected for a given release.
5. **Build the publisher** against Project EFB's *actual* receiver contract
   (re-verified in Stage 1, before this implementation work, per the
   resolved decision above), as the `upload`/`import`/`verify`/`activate`
   stages of the same run — not a separate CLI-only tool disconnected from
   the run's state.
6. **Run the six-topic verification corpus** end to end.

This is the smallest change that satisfies "article revisions are the sole
publishable path," "one orchestration model," "one registry and one signed
exporter," and "no parallel schema or duplicate exporter" simultaneously,
because it reuses every already-working piece (registry loader, low-level
exporter, article-revision bridges, deterministic+LLM classification
reconciliation pattern) and only adds the two genuinely missing capabilities
(navigation graph, publisher).

## Alternatives considered

- **Keep both stacks, add navigation+publisher on top of Stack B only.**
  Rejected: leaves the duplicate classifier and duplicate job model in place,
  which directly contradicts the stated requirement to eliminate disconnected
  status flows and a duplicate exporter path (Stack A's `TopicRecord`-direct
  route is a second, thinner exporter entry point even though it calls the
  same low-level function).
- **Build the publisher against the original `efb-publisher-phased-plan.md`
  Phase 1 schema.** Rejected outright — it is explicitly superseded and would
  create the parallel Supabase schema the objective forbids.
- **Extend `KnowledgeExportRelease` in place instead of adding a new run
  model.** Considered; rejected as the primary recommendation because
  `KnowledgeExportRelease` today only models "already-selected articles →
  package," with no stage for classification gating or navigation
  compilation before that point, and no stage for upload/import/activate
  after it. Extending it would require bolting an unrelated stage vocabulary
  onto a model whose `status` enum is already export-specific
  (`draft|queued|validating|exported|failed|cancelled|validation_failed`).
  Decision resolved: add the new `KnowledgeReleaseRun` model instead of
  extending `KnowledgeExportRelease`.

## Scope

### Expected files or systems

- `apps/web/prisma/schema.prisma`: add the new, additive `KnowledgeReleaseRun`
  model (decision resolved — not an extension of `KnowledgeExportRelease`);
  additive migration only.
- `apps/web/src/lib/knowledge/efb-classification.ts` and siblings
  (`efb-classification-core.ts`, `efb-classification-policy.ts`,
  `efb-inherited-metadata.ts`): absorb `project-efb-article-classification.ts`'s
  LLM-classification responsibility.
- `apps/web/src/lib/project-efb-article-classification.ts`: reduced to
  shared types/normalization helpers still used by the bridge, or retired
  once Stack A is redirected.
- `apps/web/src/lib/efb-release-automation.ts`: redirected to create
  `KnowledgeReleaseRun`s instead of `EfbReleaseJob`s for one release cycle
  (decision resolved — redirect, not disable), preserving all historical
  `EfbReleaseJob` rows.
- New `apps/web/src/lib/knowledge/release-run.ts` (or similar): the unified
  resumable orchestration, reusing `exportSelectedArticles`'s existing
  preflight/parity logic from `apps/web/src/lib/knowledge/export.ts`.
- New `apps/web/src/lib/navigation/classify-membership.ts`,
  `generate-root.ts`, `generate-hubs.ts`, `generate-navigation-links.ts`,
  `compile-relations.ts`, `validate-graph.ts`, `report-navigation.ts` per the
  existing requirements doc's module list.
- New `apps/web/src/lib/efb-publisher/` (`config.ts`, `types.ts`,
  `validate-package.ts`, `build-publish-plan.ts`, `upload-package.ts`,
  `import-package.ts`, `activate-package.ts`, `publish-report.ts`) and
  `apps/web/scripts/publish-efb-package.mts`, mapped to Project EFB's actual
  receiver tables/RPC once re-verified.
- `apps/web/src/lib/efb-release-export.ts`: extended (not replaced) to accept
  a compiled navigation result (root/hub artifacts, `part_of` relations,
  navigation provenance metadata) alongside existing entries.
- Tests: new `*.test.mts` colocated with every new/changed module above, plus
  updates to `apps/web/src/lib/knowledge/efb-workflow.integration.test.mts`.
- Documentation: update `docs/architecture/efb-publisher-contract-status.md`
  and `docs/roadmap/efb-publisher-phased-plan.md` phase trackers as work
  lands; `CHANGELOG.md` Unreleased entries per change (Codex's responsibility
  during implementation, not this proposal).

### Explicitly out of scope

- Vector or hybrid retrieval for the EFB package (`retrieval.jsonl` stays
  structured-keyword only).
- Building or modifying Project EFB's own agent runtime, embeddings, or
  answer generation — those remain entirely on Project EFB's side of the
  boundary documented in `project-efb-package-acceptance-contract.md`.
- Removing `TopicRecord`, `TopicBuilderRecipe/Run/Scan`, or the general
  (non-EFB) OKF export path (`okf-export.ts`) — those remain the generic
  platform's knowledge model; only the EFB-specific fan-out is consolidated.
- Multi-bundle EFB releases, quick-access placement automation, or any ATA
  chapter beyond what the existing registry/taxonomy already supports.
- Rewriting Project EFB itself or its migrations.

## Data, API, schema, and authorization implications

- All schema changes are additive (new model/columns), consistent with the
  repository's established migration pattern (e.g. the 2026-09-08
  `document_placement_scope` migration added empty-array columns only and
  required no destructive rollback). No existing table is dropped in this
  milestone; `EfbReleaseJob` and `KnowledgeExportRelease` rows remain
  readable as history even after new code stops writing new ones.
- The new release-run model is workspace-scoped like every other model in
  this area (`workspaceId` + `AuthWorkspaceContext` guard, following
  `assertArticleSourcesCurrent`'s existing pattern in
  `apps/web/src/lib/knowledge/editorial.ts`).
- The publisher is a server-side-only CLI/service; it must never expose
  Project EFB Supabase service-role credentials to the browser or commit
  them to the repo, matching the existing `efb-publisher-phased-plan.md`
  security requirements.
- Local-vault vs. production backend parity: this entire pipeline (article
  revisions, EFB classification, EFB export) is already production-Postgres-
  only per `knowledgeFeature()` flags in `apps/web/src/lib/knowledge/contracts.ts`
  — there is no local-JSON-vault equivalent to keep in parity, consistent
  with `chat-backend.ts`'s precedent of declaring a subsystem
  production-only by design.

## Edge cases and failure states

- **Registry changes mid-run**: `knowledge/export.ts` already fails closed
  with `registry_changed_during_export`/`registry_changed_review_selection`;
  the new run model must reuse this exact check at every stage boundary, not
  just at final export.
- **Navigation graph validation failure** (broken link, orphan article,
  unreachable hub): the run must fail closed before `build_package`, exactly
  as `exportEfbRelease` already fails closed on metadata mismatches — no
  partial/invalid package may reach `upload`.
- **Upload succeeds, import fails**: Project EFB's import must remain
  transactional (per the existing Phase 5 design intent); the run records
  `status: import_failed` and the previous active package is untouched.
- **Process crash mid-`build_package` or mid-upload**: the run resumes from
  its last completed stage on retry, using the same
  `currentStage`/`completedStages` resumability idiom as
  `KnowledgeAuthoringRun`. This directly answers the currently-open acceptance
  item in `docs/roadmap/efb-publisher-phased-plan.md` ("operator recovery of
  that case remains an acceptance item").
- **Concurrent release runs for the same package/selection set**: reuse the
  existing `SELECT ... FOR UPDATE` claim pattern already used in
  `knowledge/workflow.ts::approveArticleRevision` and
  `knowledge/efb-classification.ts::selectClassifiedRevision`.
- **Activation race**: activation itself is Project EFB's authoritative RPC;
  AV-OKF's obligation is idempotent retry and honest status reporting, not
  inventing its own locking over Project EFB's tables.
- **Aircraft-family ambiguity** (bare `737`, mixed NG/MAX, generic Airbus,
  conflicting effectivity): already routed to `needs_review` today by both
  `efb-classification-core.ts::deterministicClassification` and
  `efb-inherited-metadata.ts::evaluateInheritedEfbMetadata`; the consolidated
  classifier must preserve this behavior unchanged, not loosen it.
- **Rollback**: must only move Project EFB's active-version pointer; it must
  never delete, re-upload, or re-import historical package content.

## Implementation stages

1. **Re-verify the Project EFB receiver contract (decision resolved: this
   re-verification happens in Stage 1, before publisher implementation, and
   any drift found blocks only publisher work).** No AV-OKF application code
   changes. Compare `docs/architecture/efb-publisher-contract-status.md`'s
   2026-09-08 table against Project EFB's current migrations and its
   publication RPC signature. Outcome: an updated, dated contract-status note
   confirming or correcting the table/RPC mapping. Because the publisher
   (Stage 6) is the only stage that depends on the receiver contract, any
   drift discovered here blocks Stage 6 only — Stages 2–5 (classification
   unification, the release-run model, and both navigation-compiler phases)
   proceed unaffected.
   - Verifiable outcome: a reviewed, current mapping of AV-OKF's expected
     receiver tables/RPC to Project EFB's actual deployed schema, committed
     to the architecture doc.

2. **Unify classification.** Merge `project-efb-article-classification.ts`'s
   LLM path into `knowledge/efb-classification.ts`; redirect any caller still
   using the standalone classifier. Add/extend tests in
   `apps/web/src/lib/knowledge/efb-classification-core.test.mts` and
   `efb-classification-policy.test.mts` to cover the merged behavior against
   fixtures from both former call sites.
   - Verifiable outcome: exactly one classifier function is reachable from
     both the legacy-topic bridge and the article-revision path; existing
     classification test fixtures (both stacks') pass unmodified in
     assertions, only in call site.

3. **Introduce the unified resumable release-run model.** Add
   `KnowledgeReleaseRun` to `schema.prisma` (additive migration), and
   `apps/web/src/lib/knowledge/release-run.ts` implementing the staged
   sequence, porting `exportSelectedArticles`'s preflight/parity logic
   in-place rather than duplicating it. Redirect
   `efb-release-automation.ts::createAutomaticPocEfbReleaseJob` to create a
   `KnowledgeReleaseRun` (decision resolved: redirect, kept behind the
   existing flag for one release cycle, not disabled).
   - Verifiable outcome: a curator selecting approved revisions produces
     exactly one `KnowledgeReleaseRun` row whose stage history is inspectable
     end to end through `build_package`; killing the process mid-run and
     re-invoking resumes from the last completed stage without duplicate
     side effects.

4. **Navigation compiler Phases B–D**: `generate-root.ts`, `generate-hubs.ts`,
   `generate-navigation-links.ts`, `classify-membership.ts`. Wire as the
   `compile_navigation` stage. Use the existing ATA 27 profile
   (`apps/web/config/navigation/737-flight-controls.v1.yaml`) as the first
   fixture, per the requirements doc's own phase plan.
   - Verifiable outcome: compiling the current ATA 27 corpus (79 articles)
     produces exactly one root and nine hub pages with deterministic
     `part_of` membership and no unexplained unassigned articles, matching
     the requirements doc's Phase C exit gate.

5. **Navigation compiler Phases E–F**: `validate-graph.ts`,
   `compile-relations.ts` (technical-relation passthrough),
   `report-navigation.ts`, and package-integration metadata
   (`navigation.compilerVersion`/`profileId`/`profileVersion`/counts) added to
   `exportEfbRelease`'s manifest.
   - Verifiable outcome: the ATA 27 package reports 79/79 technical articles
     reachable with zero broken links and zero orphans, and a second small
     mock fixture (different ATA chapter or QRH) passes through the same
     modules with no chapter-specific code path, proving the modularity
     requirement.

6. **Publisher**: `apps/web/src/lib/efb-publisher/*` and
   `apps/web/scripts/publish-efb-package.mts`, targeting the schema/RPC
   re-confirmed in Stage 1. Implements dry-run, immutable upload,
   transactional import, verification, atomic activation, and rollback as
   stages of the same `KnowledgeReleaseRun` (not a disconnected CLI).
   - Verifiable outcome: a `--dry-run` publish of a Stage 5 package produces
     an accurate plan with zero external writes; an authorized development
     publish uploads, imports, verifies, and activates one package version
     end to end; a forced import failure leaves no partial wiki visible in
     Project EFB and the previous active package intact; rollback restores
     the prior version via pointer change only.

7. **Six-fixture end-to-end verification (decision resolved).** Automated
   acceptance runs six controlled, source-grounded fixture documents — two
   each for 737-ng, 737-max, and a320 — through the full pipeline end to
   end, documented under `docs/debug/`. Real curator-selected documents per
   aircraft family are exercised once, afterward, as the supplementary final
   rollout check before general rollout — never a substitute for the
   six-fixture run.
   - Verifiable outcome: all six fixtures reach `activated` state in a
     development Project EFB instance with correct family/ATA-or-QRH
     placement, correct navigation reachability, and a passing consumer
     validator run (`validate-knowledge-package.mjs --require-signature`);
     the subsequent real-document rollout check reaches the same outcome.

## Verification plan

- `pnpm --dir apps/web test`: full regression suite, including new/updated
  tests for every module touched above.
- `pnpm --dir apps/web lint`
- `pnpm --dir apps/web build`
- `python tools/okf_relation_lint.py --manifest okf-base.yaml` /
  `python3 -m unittest tests/test_okf_relation_lint.py`: proves generic OKF
  relation/link integrity is unaffected.
- New unit tests per stage: `release-run.test.mts` (resumability, idempotent
  retry, concurrent-claim safety), navigation compiler module tests (root/hub
  generation, graph validation, three-fixture modularity proof per the
  requirements doc's Phase G), `efb-publisher/*.test.mts` (dry-run plan
  accuracy, transactional import rollback, idempotent republish, activation
  atomicity) — these should exercise the publisher against a mocked/staged
  Project EFB Supabase instance, not the real development project, in CI.
- Manual six-topic walkthrough against a real Project EFB development
  instance: upload → extract → topic discovery → article revision →
  classify → approve → compile navigation → build package → publisher
  dry-run → publish → activate → confirm via Project EFB's own validator and
  UI/API → roll back one release → confirm the prior version is intact and
  active again.

## Risks and rollback

- **External-system risk**: the publisher writes to Project EFB's live
  Supabase project. Mitigate by defaulting every command to `--dry-run`,
  requiring an explicit `--activate` flag for state changes exactly as
  `efb-publisher-phased-plan.md` already specifies, and running automated
  tests against a mocked/staged instance rather than the real development
  project.
- **Contract drift risk**: Stage 1 exists specifically because the receiver
  contract has already changed once without AV-OKF's prior knowledge. If
  Stage 1 finds another drift, Stage 6 must be re-scoped before
  implementation, not patched around it.
- **Behavioral-regression risk from retiring Stack A**: any operator
  currently relying on `AV_OKF_EFB_EXPORT_MODE=poc`'s automatic firing loses
  that automation if Stack A is disabled outright rather than redirected.
  Mitigated by making redirection (not deletion) the default recommendation,
  with outright removal only after the unified path is verified in Stage 7.
- **Rollback of this milestone itself**: every schema change is additive, so
  reverting to the pre-milestone code (feature-flag off, or git revert) loses
  no historical data — old `EfbReleaseJob`/`KnowledgeExportRelease` rows and
  their release directories on disk remain exactly as they are today.

## Open decisions

None

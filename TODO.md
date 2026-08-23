# AV-OKF TODO

## Large-PDF Follow-Up

- [ ] Add live Metadata discovery visibility to the Processing timeline: show queued/running state, current metadata task, completed fields versus total fields, completion summary, and actionable failure/retry status using persisted backend records rather than simulated progress.
- [ ] Fix end-to-end live Processing progression so extraction, metadata discovery, concept discovery, RAG indexing, enrichment, validation, and approval transitions appear without a manual page refresh. Audit polling fingerprints and terminal-state rules, then add a browser test that observes multiple backend stage changes on the same open page.
- [ ] Run and record the required mixed text/scanned PDF test above 100 MB and 1,000 pages.
- [ ] Run the mechanical 250 MB/5,000-page upper-bound fixture before enabling the full limit operationally.
- [ ] Add multipart resumable uploads if restart-on-failure is inadequate in field use.
- [ ] Add reviewed OCR language packs beyond English based on measured corpus demand.
- [x] Requeue RAG batches paused by embedding budgets through startup and hourly reconciliation.

## Bundle-Centered Experience

- [ ] Replace full-page polling refreshes with one smooth operation-progress architecture across document processing, bulk approval, workflow, activity, relation verification, topic expansion, and deletion:
  - define a shared structured `OperationProgress` snapshot with stage, status, completed/total work, current item, attention state, actions, and fingerprint;
  - return the changed snapshot from authenticated status endpoints instead of using the fingerprint only to call `window.location.reload()` or refresh the full Server Component tree;
  - update progress strips, steppers, counts, and affected rows through client state/SWR while preserving scroll position, selections, open panels, forms, and URL state;
  - reserve `router.refresh()` for terminal transitions that genuinely require new server-rendered content, then stop polling;
  - add accessible live announcements, reduced-motion-safe transitions, reconnect/backoff handling, and desktop/mobile browser tests that observe several stage changes without a page flash or context loss.
- [x] Add a workspace-validated active-bundle cookie and searchable persistent selector.
- [x] Group navigation into Use, Manage, and Workspace workflows.
- [x] Add a bundle Workflow page that derives the full document-to-chat journey, exposes one prominent next action, and polls only while real work is active.
- [x] Add a separate bounded Topic expansion workspace that proposes at most 20 grounded additions from approved bundle concepts and returns selected drafts to normal enrichment and review.
- [x] Split the explorer into resizable Browse and full-workspace Graph views with shared file selection.
- [x] Add dedicated Review, Relations, Activity, and Bundle settings destinations.
- [x] Default Documents and uploads to the active bundle while preserving Unassigned and All workspace filters.
- [x] Resume the active bundle's latest chat and delay session persistence until the first message.
- [x] Add system-aware light, dark, and system theme selection.
- [ ] Evaluate annotations, concept correction requests, visual bundle diffs, and rollback as separately reviewed features.

## Agent Rollout

- [ ] Fix the persisted follow-up regression captured in chat `cmt0876lc000001s6m9ct4wx7`:
  - retain the active clarification subject until the user explicitly changes subjects, rather than only while the clarification is the immediately preceding assistant message;
  - require every conversation-grounded assumption shown to the user to be present in the actual retrieval query;
  - preserve validated conversation entities when query understanding falls back after a route conflict;
  - route repair, maintenance, installation, and operational-action questions through the high-risk applicability/version context checks;
  - classify approved evidence as `strong` only when it covers the question's intent, not merely because an approved concept matched;
  - add post-synthesis question/answer relevance validation without weakening citation or trust validation;
  - add the A-4000 clarification plus repeated vague follow-up sequence as a permanent regression test.
- [x] Tombstone entire historical assistant answers when any supporting citation belongs to a deleted bundle, including mixed-source answers.
- [x] Add deterministic `strong`, `partial`, `weak`, and `none` evidence-sufficiency classification with an explicit raw-RAG invocation reason in trace.
- [x] Check every selected bundle for qualified OKF before allowing raw-RAG fallback.
- [x] Add a versioned, per-bundle `agent.boundedAdaptiveRetryEnabled` flag that defaults off.
- [x] Allow one structured retrieval-query retry while preserving route, graph decision, protected identifiers, selected scope, lifecycle rules, trust order, global evidence caps, and mandatory validation.
- [x] Fail open to the original deterministic result for missing keys, provider errors, malformed output, rejected rewrites, no improvement, and validation failure.
- [x] Extend the Docker route evaluator with mid-chat bundle add/remove, exact-value conflict, later-turn scope exclusion, and cross-workspace scope rejection.
- [ ] Add running-stack fault injection for provider outage, malformed output, budget exhaustion, partial retrieval failure, and a concurrent in-flight scope mutation; unit/integration coverage exists but does not satisfy the Docker promotion gate.
- [x] Run and commit the 30-question mixed-domain baseline/candidate comparison. The tuned 2026-07-25 real-provider run improved from 15/30 to 23/30 with 100% citation precision, no baseline regression, and zero policy violations.
- [x] Tighten bounded retry without relaxing policy: append canonical expansion terms to the unchanged query, retain raw discovery labeling through merges, and deterministically repair malformed citation formatting before falling back.
- [x] Complete the blinded 30-question technical review worksheet. The candidate produced 23 complete fixed-trial responses versus 15 for baseline, with no new incorrect candidate response.
- [ ] Run the stabilized deterministic Relation Discovery V3 against the configured provider and meet the 80% internal precision checkpoint; require approximately 90% before re-enabling semantic candidate generation or automatic relation publication.
- [ ] Build the next relation-enrichment phase only after stabilization measurement: explicit anchor extraction, deterministic target resolution, two-sided evidence, relation-specific contracts, application-calibrated confidence, and bounded creator/critic review.
- [ ] Pilot adaptive retry on one internal non-safety-critical bundle for at least seven days and 50 eligible turns.
- [ ] Run the trust-UX protocol with five non-technical reviewers; any criterion missed by more than one reviewer requires a UI correction.
- [ ] Keep free model-directed tool choice evaluation-only until it beats the complete deterministic route baseline with zero policy violations.

## LLM-Assisted Authoring

- [x] Add a unified post-upload Processing panel, persistent attention strip, automatic-approval polling, and domain-neutral workflow status derived from existing job records.
- [x] Add a durable parent run for metadata discovery, concept discovery, enrichment, relation classification, and validation.
- [x] Automatically start guided authoring after production extraction.
- [x] Keep metadata changes reversible with original/proposed/applied values and actor-independent audit history.
- [x] Pause high-cost enrichment runs for explicit confirmation.
- [x] Restrict relation classification to deterministic candidate pairs and the active profile vocabulary.
- [x] Stop at `ready_for_review` by default; allow bundle admins to opt into high-confidence-only automatic enriched-topic approval/export while keeping lifecycle actions human-only.
- [x] Add a bundle-scoped review screen for selecting already-enriched topics and publishing them through a durable, sequential approval/export batch.
- [x] Continue review-ready document processing directly into the bundle's bulk topic approval and export screen.
- [ ] Pre-filter bulk review to the originating document when opened from Processing, with an explicit option to show every ready topic in the bundle.
- [x] Add bundle-scoped automatic approval/export with profile snapshots, exact-page enrichment, persisted skip reasons, and distinct chat provenance.
- [x] Add a separate bundle-scoped, default-off automatic verified-relation setting snapshotted per authoring run. Publish only exact-quote verifier results at 90% confidence or higher after shared graph preflight.
- [ ] Evaluate automatic approval quality over real bundles before considering medium-confidence eligibility.
- [ ] Consider a future per-row raw/enriched choice in bulk review; the current bulk workflow intentionally approves enriched content only while raw approval remains individual.
- [ ] Add run-level token usage and provider cost reporting from provider response metadata.
- [x] Attribute failures to the exact active stage and preserve explicit retry attempt numbers.
- [x] Condense stage status in the authoring panel while retaining expandable append-only attempt history.
- [x] Add a real-provider E2E command that resolves the workspace key saved in Settings and forbids deterministic fallback.
- [x] Verify a fresh real PDF through extraction, LLM discovery/enrichment, human approval/export, reviewed relation insertion, graph rendering, and Approved OKF chat retrieval.

## Bundle Profile Conformance And Migration

- [x] Phase 1: remove v0.1 examples from active guidance and add a regression test for legacy OKF contract fields.
- [x] Purge all runtime documents and document-derived knowledge across every workspace; verify the empty state is idempotent while preserving bundles and profiles.
- [x] Phase 2: pin all four official upstream v0.2 sample bundles at commit `fe3268a` as an attributed, fingerprinted compatibility corpus; validate 78 deterministic Markdown round trips and preserve portable/runtime/agent-readiness separation.
- [x] Phase 3: validate claim-level Markdown footnotes against `sources[].id`; keep mismatches as portable compatibility warnings while blocking ambiguous or unresolved claim attribution from strict AV runtime readiness.
- [x] Phase 4: add non-destructive first-enrichment and re-enrichment diff guards; first enrichment remains separately stored, changed reruns require an explicit reviewer decision, equivalent reruns create no review work, and failed reruns preserve the accepted article.
- [x] Phase 5: add reviewed retrieval-trigger proposals learned from retrieval misses and knowledge gaps.
- [ ] Phase 6: add privacy-minimized bundle retrieval-health and concept-usage telemetry.
- [ ] Phase 7: evaluate an index-guided, bounded mini research mode with parallel subqueries.
- [ ] Phase 8: implement staged, v0.2-only portable bundle import after every prior gate passes.
- [x] Replace the retired live-data inventory task with fixture-owned compatibility reporting that runs offline and fails CI when fixture hashes or results drift.
- [ ] Ensure every bundle contains and validates against its own generated `okf-base.yaml`; do not apply the repository aviation profile to Generic bundles.
- [ ] Correct suspicious or incomplete source metadata through the document metadata workflow, then regenerate affected OKF files through the exporter rather than editing Markdown directly.
- [ ] Migrate or remove legacy compatibility files that cannot satisfy their active profile or no longer have a valid source/topic projection.
- [ ] Run `okflint` and relation lint per live bundle and expose separate `Structurally valid` and `Agent ready` results in bundle settings.
- [ ] Add a Docker E2E proving a Generic bundle and an Aviation bundle independently pass their own profiles after export and container restart.
- [ ] Prevent profile activation or trusted publication when a generated export would violate the bundle's active schema.

## Knowledge Explorer V2

- [x] Replace the flat bundle preview with synchronized physical tree, force-directed graph, and rendered reader panes.
- [x] Derive incoming backlinks by reversing validated typed OKF relations.
- [x] Keep `?file=` as the shared deep-link selection for tree, graph, reader links, and backlinks.
- [x] Exclude archived, retracted, and deleted concepts from the explorer while keeping agent trust rules stricter than human visibility.
- [x] Degrade safely when WebGL is unavailable or a relation target is broken.
- [ ] Add PDF page opening from reader source-page metadata.
- [ ] Add an optional agent traversal overlay after Stage 7 tool execution traces are stable.

## Reviewed Relation Discovery

- [x] Add bounded document-grounded entity and relationship extraction as separate non-blocking post-enrichment jobs.
- [x] Add automatic bundle-local incremental expansion after topic export and a manual full entity reconciliation action, capped at 50 candidates per run.
- [x] Require exact chunk/page/quote evidence, deterministic name/alias/anchor resolution, one-pair verification, 95% confidence, and graph preflight before automatic publication.
- [x] Keep bundle automation default-off and add the global `AV_OKF_RELATION_AUTO_PUBLISH_ENABLED` kill switch.
- [x] Separate automatic document-local relation discovery from an explicitly triggered bundle-level graph expansion.
- [x] Add bounded cross-document semantic-neighbor candidates using the existing live OKF embedding index; embeddings propose pairs but never create edges.
- [x] Normalize common model-generated topic-type variants into the active profile vocabulary.
- [x] Allow the active profile vocabulary through one uniform strict publication gate; no relation type bypasses evidence, 95% confidence, lifecycle, or graph-integrity checks.

- [x] Add a design for workspace-scoped relation candidates with `pending`, `approved`, and `rejected` states.
- [x] Discover bundle candidate pairs deterministically; keep assisted-authoring LLM classification limited to the separately staged suggestion path.
- [x] Exclude self-links, existing edges, inactive concepts, unsafe targets, and duplicate candidates.
- [x] Add deterministic bundle-local relation discovery with reviewer approval/rejection and re-export before graph traversal.
- [x] Validate approved candidates with the existing vocabulary, path, target existence, and `target_type` checks.
- [x] Re-export the source concept so approved relations enter OKF frontmatter, the live graph, backlinks, and agent traversal together.
- [x] Keep pending/rejected candidates out of the graph retriever and chat evidence path.
- [x] Add profile-versioned discovery stopwords, two-term overlap, visible term/tag evidence, deterministic path ordering, and reviewer direction swap.
- [x] Share graph preflight across discovery, authoring promotion, and final approval, including duplicate, path, type, cycle, and supersession checks.
- [x] Add a dry-run before/after relation-evaluation command with suppression reasons and reviewer-metric placeholders.
- [x] Human-review a 12-candidate Aviation dry-run sample and record acceptance, false-positive, missed-relation, and direction-correction findings.
- [x] Add asynchronous one-pair LLM verification with exact source quotes, content hashes, append-only attempts, retry/reconciliation, and confirmed-only human review.
- [x] Require direction changes to reverify evidence against the new source and revalidate verified evidence at approval/export time.
- [x] Reconcile authoring suggestions after individual or bulk topic export so verified relations can be created automatically without entering the human review queue.
- [x] Persist automation provenance in relation frontmatter and label automation-verified edges in the human explorer.
- [x] Run a real-provider, non-aviation automatic-relation pilot in an isolated Generic bundle; all 50 proposed pairs failed closed and no unsupported edge was published.
- [ ] Run the V3 configured-provider Docker evaluation and record whether a representative sample reaches the 80% internal precision checkpoint.
- [ ] Add a related-document positive-control corpus with known explicit links; the first isolated equipment-manual pilot produced no confirmed edge, so precision and recall could not be measured.
- [ ] Require approximately 90% precision before considering reduced review, broader semantic generation, or stronger operational-relation trust.
- [ ] Repeat the human review against a populated live Generic bundle; the current Generic coverage is deterministic fixture-only.
- [ ] Tune profile stopwords and the source-page-proximity companion rule, then rerun the same evaluation before adding semantic candidates.
- [ ] Evaluate the new semantic-neighbor and document-local candidate paths on a positive-control multi-document corpus and record precision, recall, direction corrections, and publication outcomes.

## Chat Source Clarity

- [x] Add a clear answer-source badge to each assistant response:
  - `Answered from OKF`
  - `Answered from raw documents`
  - `Answered from OKF + raw documents`
  - `No evidence found`
- [x] Base the answer-source badge on actual retrieved source types, not only the router decision.
- [ ] Separate router intent from evidence actually used in the trace:
  - `Router decision`
  - `Evidence used`
- [x] Replace internal source labels with user-facing labels:
  - `okf_topic` -> `Approved OKF topic`
  - `raw_extraction` -> `Raw PDF extraction`
- [ ] Keep review status visible on each source:
  - `Approved`
  - `Unreviewed`
  - `Needs review`
- [x] Add evidence trust styling:
  - Green for approved OKF
  - Yellow for raw extracted document text
  - Gray/red for no usable evidence or unsupported answers
- [x] Show explicit fallback messaging when OKF-first routing falls back to raw RAG:
  - `No approved OKF topic matched. Answered from raw document evidence instead.`
- [ ] Make answer citation markers clickable and link them to matching source cards.
- [ ] Require every new chat citation surface to use the centralized message-aware citation-link helper so OKF navigation always returns to the originating `/chat/{sessionId}` conversation.
- [ ] Add `Open PDF page` for raw PDF/RAG evidence so users can verify the answer against the original source document.
- [ ] Add a compact `Why this answer?` panel showing:
  - Route selected
  - Evidence retrieved
  - OKF vs raw RAG trust level
  - LLM answer vs deterministic fallback
- [ ] Warn when an answer is based only on unreviewed raw extraction:
  - `This answer is based on unreviewed extracted document text. Verify against the source PDF before operational use.`
- [ ] Add tests for:
  - OKF-only answer displays `Answered from OKF`
  - RAG-only answer displays `Answered from raw documents`
  - Hybrid answer displays `Answered from OKF + raw documents`
  - OKF route with RAG fallback displays fallback notice
  - Source labels are user-friendly while preserving raw source type internally

## OKF Bundle Retriever

- [x] Treat the OKF bundle under `knowledge/` as the reviewed knowledge source of truth for OKF-routed chat answers.
- [x] Build an `OkfBundleRetriever` that reads `AV_OKF_KNOWLEDGE_ROOT` directly.
- [x] Parse bundle files from Markdown/YAML instead of requiring approved OKF topics to be embedded into the RAG database.
- [x] Read reserved bundle files:
  - `index.md`
  - `log.md`
- [x] Read portable source-reference concepts under `references/sources/` without treating them as answer-eligible evidence.
- [x] Read concept files and normalize:
  - filename/path
  - frontmatter `type`
  - `title`
  - `description`
  - `status`, `generated`, and `verified`
  - `sources`
  - `source_pages`
  - `relations`
  - `covered_rag_chunk_ids`
  - body excerpt
- [x] Update chat OKF retrieval so `okf_only` calls the bundle retriever first.
- [x] Keep raw RAG retrieval for:
  - `rag_only`
  - `hybrid` supporting context
  - explicit OKF-miss discovery fallback
- [x] Mark the existing `syncApprovedTopicsToRag` admin flow as legacy/optional cache, not the primary agent retrieval path.
- [x] Update admin copy for OKF-to-RAG sync so it does not imply OKF must be ingested into RAG.
- [x] Add tests:
  - OKF retriever reads a temp bundle and returns approved topics.
  - OKF retriever ignores non-approved concept files.
  - OKF retriever ignores/resists unsafe paths.
  - `okf_only` chat route can answer from bundle files without RAG DB `okf_topic` chunks.
  - OKF miss falls back to raw RAG discovery and shows the raw evidence card.
  - Hybrid returns OKF bundle evidence plus raw RAG supporting evidence.

## Stage 7 Closeout

- [x] Add a Docker-backed route-coverage evaluation for every current router path and retrieval mode, with persisted-trace assertions and a committed baseline.
- [x] Add a permanent five-question raw-RAG retrieval evaluation with saved baseline/post-change reports and a citation-regression guard.
- [x] Add profile-driven metadata clarification for weak approved OKF candidates, with no diagnostic-candidate leakage into answers or validation and raw-RAG fallback after the single clarification round.
- [x] Preserve a concise insufficient-evidence response when the LLM returns `supported: false`; do not replace it with concatenated excerpts solely because citations were retrieved.
- [ ] Add a permanent mixed-domain chat evaluation set covering direct OKF, OKF via graph, raw RAG discovery, hybrid support, missing evidence, and retrieval failure.
- [x] Make citation markers open their matching OKF concept or authenticated source PDF page.
- [x] Add browser-native `Open PDF page` links for raw evidence and bundle-explorer links for OKF concepts.
- [x] Show lifecycle notices and disable links when a historical citation now points to archived, retracted, or deleted knowledge.
- [ ] Add custom PDF viewer behavior only if browser-native `#page=N` navigation proves inconsistent in supported browsers.
- [ ] Add an explicit coverage-link reconciliation action separate from raw RAG reindex.

## Agent Tool Layer

- [x] Define bounded Vercel AI SDK tool wrappers for `searchOkf`, `readOkfFile`, `followOkfRelation`, `searchCoveredRag`, `searchRawRag`, `readSourcePages`, and `validateAnswerEvidence`.
- [x] Keep the deterministic router, lifecycle gates, hop limits, workspace checks, and validator authoritative while the tool layer is introduced.
- [x] Persist tool calls and outcomes in the existing chat trace.
- [x] Add an evaluation-only model-directed runner with discovered-evidence capabilities and a mandatory reserved validation call.
- [ ] Run the evaluation-only model runner against the configured-provider Docker route-coverage baseline before any production promotion decision.
- [ ] Consolidate production agent orchestration on the existing Vercel AI SDK tool layer instead of introducing a second production agent framework.
- [ ] Add one explicit bounded workflow for conversational query resolution: carry forward the prior subject, search approved OKF, classify evidence sufficiency, retry one protected rewrite when weak, search raw RAG only for a named gap, follow approved relations when useful, and run mandatory evidence validation.
- [ ] Extend the paraphrase and follow-up evaluation corpus to prove that the bounded workflow improves retrieval recall without route changes, bundle-scope leaks, trust upgrades, or citation regressions.
- [ ] Keep free model-directed tool selection evaluation-only; do not replace deterministic production authority based on subjective answer quality.
- [ ] Evaluate LangGraph separately only for an optional user-triggered research mode that demonstrably requires durable multi-step execution, resumability, or human interrupts. Do not introduce it into ingestion, authoring, or ordinary chat retrieval.

## Dynamic Multi-Bundle Chat Scope

- [x] Keep one bundle as the focused default when a chat starts.
- [x] Add a visible `Knowledge sources` selector to the active chat so users can add or remove bundles without starting a new conversation.
- [x] Persist the active selected bundle IDs on the chat session and enforce workspace ownership and active lifecycle state for every selection.
- [x] Snapshot the effective bundle scope on each message and assistant trace so historical answers retain their original retrieval scope.
- [x] Apply bundle changes to future questions only; removing a bundle does not rewrite prior answers or citations.
- [ ] Allow the agent to suggest another relevant bundle but never add it or widen search scope without user action.
- [x] Add a bundle-discovery step that ranks only the selected bundles before concept retrieval instead of blindly crawling every file.
- [x] Search approved, active OKF concepts across at most ten selected bundles with bounded concurrency and global result caps.
- [x] Keep graph traversal and typed relations bundle-local in the first version.
- [x] Restrict raw RAG fallback to documents belonging to the selected bundles.
- [x] Include the originating bundle identity on every citation, evidence row, and agent trace entry.
- [x] Preserve trust precedence independently per bundle: human-approved OKF, automation-approved OKF, then labeled raw RAG discovery/support.
- [x] Detect conflicting exact values across selected approved bundles and disclose the conflict instead of silently merging them.
- [x] Handle unavailable or deleted selected bundles explicitly without silently substituting another bundle.
- [x] Add unit coverage for ordered scope persistence, limits, workspace isolation, global result caps, bundle-local traversal, conflict detection, and deletion preservation.
- [ ] Extend the Docker route-coverage profile with mid-chat add/remove, concurrent scope snapshot, conflict, lifecycle, deletion, and cross-workspace scenarios.
- [ ] Defer cross-bundle typed relations until stable concept identities and dedicated validation rules exist.

## Platform Follow-Up

- [x] Add a workspace-scoped multi-bundle registry with required upload/chat bundle selection.
- [x] Add Generic and Aviation profile templates plus versioned custom profile drafts and validated activation.
- [x] Add durable, typed-confirmation bundle deletion through the BullMQ worker.
- [x] Reconcile the exporter and consumer with the published OKF v0.2 specification:
  - use the pinned [OKF v0.2 adoption decision](docs/architecture/okf-v0.2-adoption.md) as the migration contract;
  - make OKF v0.2 the only supported bundle format after migration;
  - map authoring provenance to `generated`, approval provenance to `verified`, source provenance to `sources`, and lifecycle to `status`/`stale_after`;
  - replace generated `updated` metadata with `generated.at`;
  - preserve typed relations, source pages, approval modes, and richer lifecycle states as AV-OKF extensions while exposing standard Markdown links for portable graph traversal;
  - preserve unknown v0.2 and producer-defined fields during parse/export round trips;
  - resolve `source_manifest.md` conformance because OKF v0.2 reserves only `index.md` and `log.md`;
  - provide a backed-up, dry-run, resumable migration that validates every bundle before the application switches to v0.2-only reads and writes.
- [x] Run and review `migrate:okf-v0.2` dry-run reports for every production workspace, create the maintenance-window database/vault backups, apply the all-bundle cutover, and complete the browser/E2E release gate before enabling portable import.
- [ ] Implement portable OKF v0.2 archive import through staged validation,
  target-workspace trust review, atomic activation, and projection/index
  rebuilding; do not import foreign database identifiers or trust claims.
- [ ] Add richer relation-candidate editing before approval.
- [ ] Add column-aware PDF extraction before trusting high-confidence topics from multi-column documents.
- [x] Replace production heading-only topic generation with automatic document-wide LLM topic discovery.
- [x] Analyze every extracted page in bounded overlapping windows and consolidate candidates into section-level drafts.
- [x] Preserve approved/rejected topics when discovery is rerun and block overlapping replacement drafts.
- [x] Record source-page coverage, categorical confidence, heading evidence, boundary rationale, provider/model, and discovery audits.
- [x] Keep missing-provider documents extracted and RAG-ready while discovery waits for configuration and retry.
- [x] Generate a separate enriched Markdown article and require reviewer acceptance for proposed additional source pages.
- [ ] Add permanent real-provider topic-quality evaluations for Air/Ground, forklift, multi-column, and generic documents.
- [ ] Capture provider-reported input/output token usage and estimated monetary cost in discovery audit records.
## Entity Modeling

- [x] Surface exact-source-quoted entity candidates from validated chat answers.
- [x] Promote a selected candidate into the existing review and enrichment workflow without auto-approval.
- [x] Add workspace canonical identities with bundle-scoped grounded occurrences, classifications, aliases, and relation assertions.
- [x] Auto-register only matching normalized names and types supported by two independent documents; keep homonyms and conflicts review-required.
- [x] Add exact accepted-alias reconciliation and deterministic target resolution while keeping acronym and fuzzy aliases review-required.
- [x] Add reviewed multi-document provenance and entity consolidation persistence.
- [ ] Suppress already-known entity suggestions before rendering the chat response.
- [x] Add Published knowledge, Entity map, and Needs attention graph presentation with evidence details.
- [ ] Run the configured-provider multi-document entity/relation evaluation; keep global publication disabled until precision is approximately 90% with no negative-control regression.

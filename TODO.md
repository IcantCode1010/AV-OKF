# AV-OKF TODO

## LLM-Assisted Authoring

- [x] Add a unified post-upload Processing panel, persistent attention strip, automatic-approval polling, and domain-neutral workflow status derived from existing job records.
- [x] Add a durable parent run for metadata discovery, concept discovery, enrichment, relation classification, and validation.
- [x] Automatically start guided authoring after production extraction.
- [x] Keep metadata changes reversible with original/proposed/applied values and actor-independent audit history.
- [x] Pause high-cost enrichment runs for explicit confirmation.
- [x] Restrict relation classification to deterministic candidate pairs and the active profile vocabulary.
- [x] Stop at `ready_for_review` by default; allow bundle admins to opt into high-confidence-only automatic enriched-topic approval/export while keeping relation and lifecycle actions human-only.
- [x] Add a bundle-scoped review screen for selecting already-enriched topics and publishing them through a durable, sequential approval/export batch.
- [x] Continue review-ready document processing directly into the bundle's bulk topic approval and export screen.
- [ ] Pre-filter bulk review to the originating document when opened from Processing, with an explicit option to show every ready topic in the bundle.
- [x] Add bundle-scoped automatic approval/export with profile snapshots, exact-page enrichment, persisted skip reasons, and distinct chat provenance.
- [ ] Evaluate automatic approval quality over real bundles before considering medium-confidence eligibility.
- [ ] Consider a future per-row raw/enriched choice in bulk review; the current bulk workflow intentionally approves enriched content only while raw approval remains individual.
- [ ] Add run-level token usage and provider cost reporting from provider response metadata.
- [x] Attribute failures to the exact active stage and preserve explicit retry attempt numbers.
- [x] Condense stage status in the authoring panel while retaining expandable append-only attempt history.
- [x] Add a real-provider E2E command that resolves the workspace key saved in Settings and forbids deterministic fallback.
- [x] Verify a fresh real PDF through extraction, LLM discovery/enrichment, human approval/export, reviewed relation insertion, graph rendering, and Approved OKF chat retrieval.

## Bundle Profile Conformance And Migration

- [ ] Write a dry-run inventory that maps every live bundle file to its owning workspace, bundle, active profile, source document, and exported topic.
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
- [ ] Run the V3 configured-provider Docker evaluation and record whether a representative sample reaches the 80% internal precision checkpoint.
- [ ] Require approximately 90% precision before considering reduced review, bulk relation approval, semantic expansion, or stronger operational-relation trust.
- [ ] Repeat the human review against a populated live Generic bundle; the current Generic coverage is deterministic fixture-only.
- [ ] Tune profile stopwords and the source-page-proximity companion rule, then rerun the same evaluation before adding semantic candidates.
- [ ] Decide from those metrics whether semantic top-K neighbors or weighted scoring are justified; free-form LLM pair generation remains out of scope.

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
  - `source_manifest.md`
  - `log.md`
- [x] Read concept files and normalize:
  - filename/path
  - frontmatter `type`
  - `title`
  - `description`
  - `review_status`
  - `source_file`
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

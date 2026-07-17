# AV-OKF TODO

## Knowledge Explorer V2

- [x] Replace the flat bundle preview with synchronized physical tree, force-directed graph, and rendered reader panes.
- [x] Derive incoming backlinks by reversing validated typed OKF relations.
- [x] Keep `?file=` as the shared deep-link selection for tree, graph, reader links, and backlinks.
- [x] Exclude archived, retracted, and deleted concepts from the explorer while keeping agent trust rules stricter than human visibility.
- [x] Degrade safely when WebGL is unavailable or a relation target is broken.
- [ ] Add PDF page opening from reader source-page metadata.
- [ ] Add an optional agent traversal overlay after Stage 7 tool execution traces are stable.

## Reviewed Relation Discovery

- [ ] Add a design for workspace-scoped relation candidates with `pending`, `approved`, and `rejected` states.
- [ ] Discover candidate concept pairs from deterministic signals before using the workspace LLM to suggest a controlled-vocabulary relation and reason.
- [ ] Exclude self-links, existing edges, inactive concepts, unsafe targets, and duplicate candidates.
- [x] Add deterministic bundle-local relation discovery with reviewer approval/rejection and re-export before graph traversal.
- [ ] Validate approved candidates with the existing vocabulary, path, target existence, and `target_type` checks.
- [ ] Re-export the source concept so approved relations enter OKF frontmatter, the live graph, backlinks, and agent traversal together.
- [ ] Keep pending/rejected candidates out of the graph retriever and chat evidence path.
- [ ] Add audit records and mixed-domain relation-discovery evaluations.

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

- [ ] Preserve a concise insufficient-evidence response when the LLM returns `supported: false`; do not replace it with concatenated excerpts solely because citations were retrieved.
- [ ] Add a permanent mixed-domain chat evaluation set covering direct OKF, OKF via graph, raw RAG discovery, hybrid support, missing evidence, and retrieval failure.
- [ ] Make citation markers focus or scroll to their matching source row.
- [ ] Add `Open PDF page` for raw evidence and OKF source-page references.
- [ ] Show lifecycle notices when a historical citation now points to archived or retracted knowledge.
- [ ] Add an explicit coverage-link reconciliation action separate from raw RAG reindex.

## Agent Tool Layer

- [ ] Define bounded Vercel AI SDK tool wrappers for `searchOkf`, `readOkfFile`, `followOkfRelation`, `searchCoveredRag`, `searchRawRag`, `readSourcePages`, and `validateAnswerEvidence`.
- [ ] Keep the deterministic router, lifecycle gates, hop limits, workspace checks, and validator authoritative while the tool layer is introduced.
- [ ] Persist tool calls and outcomes in the existing chat trace.
- [ ] Evaluate bounded model-directed tool selection before considering any autonomous multi-step loop.

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

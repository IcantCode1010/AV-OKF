# MVP Stages Roadmap

## Goal

Build AV-OKF in stages, starting with a generic document management foundation and ending with an agentic chat system that can use OKF and RAG together.

The first usable product should be a clean document vault. Chat comes later, after ingestion, citations, review status, and retrieval exist.

## Stage 0: Product Shell

Purpose: create the basic application frame.

Deliverables:

- App scaffold
- Authentication placeholder or initial auth integration
- Workspace model
- Sidebar navigation
- Dashboard layout
- Settings shell
- Document library shell

Exit criteria:

- A user can open the app, enter a workspace, and see a polished document dashboard shell.

## Stage 1: Document Vault

Purpose: create the Papra-style document management foundation.

Deliverables:

- PDF upload
- File storage abstraction
- Document metadata
- Document list
- Document detail page
- Tags
- Custom properties
- Processing status field

Exit criteria:

- A user can upload PDFs, see them in a document library, tag them, and open a document detail page.

## Stage 2: Extraction Pipeline

Purpose: convert uploaded documents into page-level extracted records.

Deliverables:

- Background extraction job
- Page text extraction
- Table extraction
- Image metadata extraction
- Page number preservation
- Document processing statuses
- Extraction logs
- Defensive handling for malformed, corrupt, and password-protected PDFs. The upload-time magic-byte check confirms file type only, not structural validity.
- Stage 2 uses local in-process background extraction with client-side polling while a document is processing. This assumes a long-lived Node process and must be replaced with a durable queue or worker before serverless deployment.
- Known limitation: text extraction does not detect multi-column page layout. Multi-column pages interleave column text line-by-line, which corrupts both page text and the Stage 3 heading detector's boundary picks. A 737 AMM student-book page (ata 32, pages 93-94) produced an approved-then-rejected topic from this defect; see `knowledge/log.md`. Column-aware extraction is required before heading-derived topics from multi-column manuals can be trusted at `high` confidence.

Exit criteria:

- An uploaded PDF produces page-level extracted text and source page references.

## Stage 3: Topic Records

Purpose: turn extracted document structure into reviewable knowledge candidates.

Topic records should come from document structure, not arbitrary RAG chunks.

Deliverables:

- Topic boundary detection
- Heading, table-of-contents, and page-range analysis
- Topic record schema
- Topic title, type, summary, page range, and source references
- Confidence score
- Review status
- Topic review UI
- Manual topic generation only. Re-extraction does not automatically regenerate topics in Stage 3.
- Reruns delete `needs_review` and `needs_cleanup` topics, preserve `approved` and `rejected` topics, and skip new draft topics that overlap reviewed page coverage.
- Confidence is categorical: `high` for ALL-CAPS or explicitly numbered/lettered heading matches, `medium` for the weaker short-line heading heuristic, and `low` for the coarse page-range fallback.
- Heading detection rejects page-index/cross-reference code lines (e.g. `"0.1"`, `"Lights.Index.5"`) so they don't get mistaken for section headings; a 737 QRH document produced 368 mostly single-page junk-titled topics before this fix.
- `sourcePageNumbers` is the page coverage field that Stage 5 OKF export will consume.

Exit criteria:

- A user can inspect generated topic records and mark them for review, approval, rejection, or cleanup.

## Stage 3.5: Docker/VPS Deployment

Purpose: make the MVP deployable as a single-node Docker application before adding retrieval and agent features.

This stage targets one container on one VPS with one mounted persistent data volume. It is not a multi-replica, serverless, or horizontally scaled architecture.

Deliverables:

- Dockerfile for the web app
- Docker Compose configuration
- Persistent `/data` volume for the JSON vault and uploaded PDFs
- `AV_OKF_DATA_ROOT` runtime configuration
- Health endpoint for reverse proxy and container checks
- Deployment README instructions
- Explicit limitation note: local JSON storage and in-process extraction are MVP-only and must later move to database/object storage plus a durable queue or worker

Exit criteria:

- The app can run with `docker compose up`.
- Uploaded PDFs, extraction records, and topic records survive container restart through the mounted volume.
- The container binds to `0.0.0.0:3000` and reports healthy through `/api/health`.

## Stage 3.6: Postgres Repository

Purpose: replace the production JSON vault path with a Postgres-backed repository while preserving the current UI behavior.

Deliverables:

- Prisma schema and migration for users, Auth.js records, workspaces, documents, document objects, extraction jobs, extracted pages, extraction logs, topic records, custom properties, and activity events
- Workspace-scoped document repository
- Production backend selector behind the existing document functions
- Local JSON vault retained only as a development/test fixture
- No production path writes `document-vault.json`

Exit criteria:

- Documents, metadata, extraction state, topics, and activity persist in Postgres.
- Document queries are scoped by workspace membership.
- The document UI still works through the same app routes.

## Stage 3.7: Object Storage

Purpose: move uploaded PDFs out of local disk storage and into an S3-compatible object store.

Deliverables:

- `ObjectStorage` interface
- S3-compatible adapter for MinIO, AWS S3, Cloudflare R2, or equivalent
- Opaque scoped object keys under `workspaces/{workspaceId}/documents/{documentId}/original/{uuid}.pdf`
- `document_objects` records for original PDFs
- Extraction reads PDFs from object storage

Exit criteria:

- Uploaded PDFs are stored in MinIO for the VPS Compose stack.
- Raw filenames are never used as storage paths.
- Object storage can be swapped by env config without changing app code.

## Stage 3.8: Durable Queue And Worker

Purpose: replace in-process detached extraction with a durable Redis/BullMQ queue and a separate worker container.

Deliverables:

- `ExtractionQueue` interface
- BullMQ extraction queue
- Separate long-running worker entrypoint
- Deterministic job IDs in the form `extract:{documentId}:{extractionJobId}`
- Worker startup reconciliation for queued or abandoned running jobs
- Retry/backoff for transient worker, Redis, or object-storage failures
- Normalized extraction failures: `malformed_pdf`, `password_protected_pdf`, `missing_stored_pdf`, and `extraction_failed`

Exit criteria:

- Upload returns immediately after enqueue.
- Restarting `web` does not lose jobs.
- Restarting `worker` resumes queued work.
- Malformed PDFs land in blocked state.

## Stage 3.9: Auth And Public VPS

Purpose: add real user sessions, workspace membership enforcement, and public VPS reverse proxy assumptions.

Deliverables:

- Auth.js OAuth with GitHub and/or Google providers
- Prisma-backed users, accounts, sessions, and verification tokens
- Default workspace creation on first login
- Workspace membership checks in production Server Actions and repository queries
- Caddy reverse proxy config
- Backup and restore guidance for Postgres and MinIO

Exit criteria:

- Unauthenticated users cannot access product shell routes.
- Users only see records in workspaces where they are members.
- The app is reachable through Caddy and can be configured for HTTPS on a VPS.
- Postgres, Redis, and MinIO are not exposed publicly.

## Stage 4: Search And RAG

Purpose: support broad discovery across raw and semi-structured content.

RAG indexing happens immediately after extraction and does not wait for human review. RAG is allowed to index raw and unapproved content, but that content must retain source and review-status labels.

Deliverables:

- Chunk generation
- Keyword search
- Vector search
- Hybrid retrieval
- OpenAI `text-embedding-3-small` production embedding provider
- deterministic local/test embedding provider
- pre-call token budget enforcement
- Postgres + pgvector vector storage
- Source filters
- Citation objects
- Search UI

Coverage projection moved to Stage 5 (consumes OKF concepts).

Exit criteria:

- A user can search across uploaded documents and retrieve relevant passages with citations.
- Newly ingested documents become searchable before OKF approval.

## Stage 5: OKF Bundle

Purpose: turn human-approved topic records into structured agent-readable knowledge.

OKF generation is slower and review-gated. Approved OKF concepts should link back to the source pages and RAG chunks they cover.

Deliverables:

- Knowledge object model
- OKF frontmatter schema
- `okflint` profile for required frontmatter by file type
- Explicit link-resolution profile
- Typed relation field and controlled vocabulary
- Markdown exporter
- `index.md` generation
- `source_manifest.md` generation
- derived OKF-to-RAG coverage projection; OKF frontmatter remains the source of truth
- OKF-to-RAG coverage links
- Bundle validation
- Deterministic link lint for relative Markdown graph links and relation targets
- Deterministic relation lint for relation enum values, target resolution, and target type matching
- GitHub Actions `okflint validate` CI gate
- Bundle-first Knowledge page
- Folder-style OKF bundle explorer grouped by reserved files, system topics, fault routes, routing rules, and other files
- OKF Markdown file preview inside the bundle explorer

Exit criteria:

- Approved topic records export into valid OKF-style Markdown files with source references.
- Internal graph links resolve under the AV-OKF link-resolution profile.
- Approved OKF concepts can identify the RAG chunks and source pages they govern.
- Operational links use typed relations such as `routes_to`, `references`, `supports`, `covered_by`, `supersedes`, and `conflicts_with`.
- Relation targets declare a `target_type` that matches the resolved target file's frontmatter `type`.
- MVP-02 is enforced by `okflint validate --manifest okf-base.yaml`, not a custom schema checker.
- A user can open the Knowledge page, select the `AV-OKF Knowledge Bundle`, browse the whole exported bundle structure, and preview reserved files or approved OKF topics without inspecting raw filesystem paths.

Architecture note:

- [okflint Profile](../architecture/okflint-profile.md)
- [Link Resolution](../architecture/link-resolution.md)
- [Typed Relations](../architecture/typed-relations.md)

## Stage 6: Chat Agent

Purpose: let users ask questions across the document collection through a router-first agent flow.

The query router is the first component in Stage 6. It decides whether a question should use OKF, RAG, Hybrid, missing-context handling, or unsupported handling before any retrieval tools run.

Deliverables:

- Chat sessions
- Chat messages
- Query router
- Query classification: canonical, open-ended, comparison, source lookup, high-risk domain, or missing context
- Router outputs: `okf_only`, `rag_only`, `hybrid`, `missing_context`, or `unsupported`
- Router confidence and rationale stored in the agent trace
- OKF retrieval tool
- RAG retrieval tool
- Hybrid retrieval mode only when both curated knowledge and raw evidence are needed
- Answer builder
- Citation renderer
- Agent trace drawer

Router rules:

```text
Canonical/direct/stable question -> OKF
Open-ended/search/summarization question -> RAG
Question needing an official concept plus raw examples -> Hybrid
Question missing required context -> Missing Context
Question requiring live data or external authority -> Unsupported or Tool/API route later
```

Implementation note:

```text
Start with a rules-first router plus an LLM fallback. Do not run OKF and RAG together unless the router selects Hybrid.
```

Progress note: the router (rules-first, no LLM fallback yet), OKF retrieval tool, RAG retrieval tool, hybrid mode, citation renderer, agent trace drawer, and the LLM answer builder (`chat-answer.ts`) are implemented. When the workspace has an LLM provider key configured (Settings), replies are synthesized from the retrieved evidence with enforced `[n]` citation markers — answers with missing or out-of-range markers are rejected and fall back to the deterministic excerpt echo, as do provider failures and workspaces without a key, so the citation-echo path remains the floor. The trace records `answerMode` (`llm`/`deterministic`) plus provider/model. Retrieval's source-type/approval filters are applied server-side by `rag-repository.ts` (`filters.sourceTypes`/`reviewStatus`); `chat-retrieval.ts` keeps a client-side guard as defense-in-depth.

Agent-readiness pass: `routeChatQuestion` now also accepts the structured input shape from [Query Router](../architecture/query-router.md) (`question`/`workspaceId`/`conversationContext`), and `sendMessage` threads recent session turns through as that context — the seam a future LLM/agent router consumes without callers changing. Rules were widened to cover plain interrogative questions (`what is`, `how does`, `explain`, `describe`), which previously fell through to `missing_context` for anything not using an exact keyword like "definition" or "official". Hybrid retrieval now reads OKF before RAG (sequential, not parallel) per [Ingestion To Knowledge Flow](../architecture/ingestion-to-knowledge-flow.md), and an `okf_only` route with no approved evidence downgrades to labeled RAG discovery (unreviewed, never presented as official) instead of a dead-end reply. The trace now also records `approvedOkfAvailable`, `ragUsedForDiscoveryOnly`, and `finalEvidenceStatus` (`approved_evidence`/`discovery_evidence`/`no_evidence`/`retrieval_error`) — the OKF-priority signals [Validation Agent](../architecture/validation-agent.md) needs. Citations now carry `coveredByOkfConceptIds` so a future validator can treat a covering approved OKF concept as controlling over a raw RAG chunk.

Stage 6 closeout correction: the LLM fallback classifier is now implemented for low-confidence rule results, with high-confidence safety routes kept rules-first. The current Stage 6 boundary is router-first retrieval, evidence-bound answer synthesis, citations, and traceability; gap-targeted hybrid retrieval and claim-level validation move to Stage 7.

Stage 6.5 architecture correction: OKF retrieval should read the exported OKF bundle files directly, not depend on `okf_topic` rows embedded into the RAG vector database. The `okf_topic` RAG projection remains a legacy/optional cache from the Stage 4 follow-up, but the agent path should treat `knowledge/` as the reviewed knowledge source of truth. RAG remains the raw document discovery layer; OKF remains the reviewed Markdown/YAML bundle the agent can crawl through `index.md`, frontmatter, links, relations, `source_manifest.md`, and `log.md`.

Exit criteria:

- A user can ask questions and see whether the router sent the query to OKF, RAG, Hybrid, or missing-context handling.
- Agent traces show the router category, route, confidence, and rationale.
- Hybrid retrieval is demonstrably not the default path.
- OKF-routed answers can be sourced from actual exported bundle files, with raw RAG used only for discovery fallback or hybrid supporting context.

Architecture note:

- [Query Router](../architecture/query-router.md)

## Stage 6.6: Knowledge Lifecycle Management

Purpose: define what happens when documents, topics, OKF files, coverage links, and chat citations are deleted, retracted, archived, restored, or superseded.

Every prior stage answered how knowledge gets created or updated. This stage answers what happens when knowledge is removed from one layer of the derived-data chain:

```text
document -> extraction -> topics -> OKF concepts -> RAG chunks -> coverage links -> chat citations
```

Scope rule:

- This stage is design and decisions first, code second.
- Submit the lifecycle design doc for review before writing deletion logic.
- Do not bundle lifecycle behavior into unrelated implementation work. Deletion touches every layer and needs its own reviewable slice.

Deliverables:

- Document deletion policy and cascade rules.
- Uploaded object deletion policy for disk/S3 storage.
- Extracted-page cleanup policy.
- Topic deletion, rejection, and orphaning policy.
- RAG chunk and embedding cleanup policy.
- Approved OKF concept protection policy when its source document is deleted.
- OKF file lifecycle states such as `approved`, `retracted`, and `archived`.
- Supersession derived from the existing `supersedes` typed relation, not a separate lifecycle source of truth.
- Multi-bundle lifecycle states deferred until multi-bundle support exists.
- Runtime guard for broken typed relations during live OKF bundle retrieval.
- Coverage-link cleanup or stale-link marking rules.
- Explicit soft-delete versus hard-delete decision by data type.
- Append-only lifecycle entries in `log.md`.
- Agent retrieval rules that exclude deleted, retracted, archived, superseded, or invalid lifecycle states from trusted evidence.

Design questions that must be answered before implementation:

1. When a document is deleted, what happens to the uploaded source file, extracted pages, topic records, RAG chunks, embeddings, coverage links, activity records, and chat citations?
2. If a document has an approved OKF concept derived from it, does deletion block, require confirmation, or mark the OKF concept's source as orphaned?
3. If a topic is deleted or rejected after OKF export, is the exported concept retracted, archived, superseded, or left active?
4. If a relation target is deleted after CI passed, does the live OKF bundle retriever skip the broken relation, degrade safely, or fail the query?
5. When either side of a RAG-chunk-to-OKF-concept coverage link is removed, is the link deleted or marked stale?
6. Which data types use soft-delete versus hard-delete, and why?

Default recommendation:

- Soft-delete source documents, topic records, exported OKF concepts, and audit-bearing objects.
- Hard-delete or rebuild derived indexes such as RAG chunks and embeddings when safe, because they are search projections rather than records of truth.
- Block deletion of a source document that has approved OKF concepts until the reviewer explicitly retracts, supersedes, or archives those concepts.
- Reconcile OKF-to-RAG coverage links through an explicit trigger, not as a hidden side effect of RAG reindex.

Test plan:

- Unit tests for every cascade decision.
- End-to-end test for deleting a document that has an approved OKF concept, confirming the chosen behavior.
- Runtime test for a broken relation target during live OKF retrieval.
- Race-style test where a referenced file changes during chat retrieval and chat degrades without crashing.
- Regression:
  - `pnpm --dir apps/web test`
  - `pnpm --dir apps/web lint`
  - `pnpm --dir apps/web build`
  - `python tools/okf_relation_lint.py --manifest okf-base.yaml`

Exit criteria:

- The project has a reviewed lifecycle design covering document deletion, OKF concept retirement, relation breakage, coverage cleanup, and chat-citation history.
- No implementation path can silently leave trusted agent evidence pointing at deleted, missing, or retracted sources.
- The agent retriever treats lifecycle state as part of trust, not just file existence.

Architecture note:

- [Knowledge Lifecycle Management](../architecture/knowledge-lifecycle.md)

## Stage 7: Answer Evidence Validation

Purpose: keep the agent honest about where an answer came from. The agent searches approved wiki-style OKF articles first across the active knowledge bundle(s). If approved OKF fully answers the question, it answers from OKF. If OKF is missing or incomplete, raw RAG may provide supporting discovery context, but it is always labeled unreviewed. If neither source provides evidence, the agent says it cannot answer.

Stage 7 is intentionally smaller than the original Validation Agent design. It does not attempt to prove every sentence semantically yet. It validates the evidence contract around the answer and creates real failure data for a later claim-level validator.

Stage 7A deliverables:

- Deterministic post-answer evidence validation.
- Citation index, source detail, page-range, and citation-marker checks.
- OKF-first policy check: raw RAG fallback must be explicitly labeled.
- Lifecycle-aware source status checks through the existing retrieval path.
- Safe fallback to a cited evidence response when generated output fails validation.
- Persisted validation result in the existing chat trace.
- Evidence modes: approved OKF, raw RAG, mixed, or no evidence.

Stage 7A exit criteria:

- Every evidence-backed answer has valid citations and an inspectable validation result.
- Invalid or uncited generated answers fall back to cited retrieved evidence.
- No-evidence answers do not invent citations and are clearly blocked from being treated as authoritative.
- Approved OKF remains controlling when raw RAG is also present.

Stage 7B: Agent-Ready OKF Graph Retrieval

Purpose: make the agent useful for questions that require more than one approved OKF concept, without turning raw or automatically discovered relationships into trusted knowledge.

Agent policy:

- Search approved, active-lifecycle OKF concepts first.
- Answer directly when one concept provides a high-confidence complete answer.
- When the question requires cross-concept reasoning, traverse the existing typed OKF relation graph with a bounded hop count.
- Pull RAG chunks through existing `OkfConceptChunkLink` coverage links for concepts visited during traversal.
- Use open raw RAG discovery only when graph-linked evidence is still incomplete or when graph traversal is not required.
- Run validation on every path and label answers as direct OKF, OKF via graph, mixed supported evidence, raw RAG discovery, partial with limitations, clarification needed, or unsupported with a next step.
- Never dead-stop without explaining what was searched and offering a useful clarification or next action; never fill missing evidence with a guess.

Stage 7B deliverables:

- Bounded `followOkfRelation` traversal over existing typed relations.
- Cycle prevention, visited-file tracking, safe-path checks, lifecycle filtering, and broken-target warnings.
- Coverage-linked RAG retrieval for visited approved concepts.
- Deterministic `requiresGraphTraversal` signal added to the existing router decision; deterministic rules remain first and LLM fallback remains limited to low-confidence routing.
- Trace and evidence-card support for `direct_okf`, `okf_via_graph`, `mixed_supported`, `rag_discovery`, `partial_with_limitations`, `clarification_needed`, and `unsupported_with_next_step`.
- Helpful bounded query reformulation and targeted clarification behavior.
- Tool contracts ready for Vercel AI SDK integration: `searchOkf`, `readOkfFile`, `followOkfRelation`, `searchCoveredRag`, `searchRawRag`, `readSourcePages`, and `validateAnswerEvidence`.

Stage 7B exit criteria:

- Direct OKF questions answer from approved bundle evidence without RAG.
- Multi-concept questions can traverse approved relations and cite the concepts and source pages used.
- Coverage-linked RAG is preferred before broad raw RAG discovery.
- Missing evidence produces a useful clarification or limitation response rather than an unsupported answer.
- Traversal cannot loop, escape the bundle root, or surface inactive/retracted/archived concepts as current authority.

Deferred from Stage 7B:

- Automatic LLM extraction of a second graph from raw documents.
- Neo4j or another dedicated graph database.
- Automatic approval of derived relationships.
- Multi-agent swarms and unrestricted autonomous loops.

Deferred Stage 7 work:

- LLM-based atomic claim extraction and claim typing.
- Semantic claim-to-evidence judging.
- Aviation-specific authority rules and risk thresholds.
- Automatic rewriting or refusal of individual unsupported claims.
- Detailed claim-level validation reports.

Architecture note:

- [Validation Agent](../architecture/validation-agent.md)
- [Ingestion To Knowledge Flow](../architecture/ingestion-to-knowledge-flow.md)

## Stage 8: Aviation Domain Pack

Purpose: prove the generic platform in a high-trust technical domain.

Deliverables:

- Aviation metadata schema
- ATA classifier
- Manual authority rules
- Source authority categories
- Effectivity fields
- Aviation answer templates
- Aviation validation rules
- 737NG sample workflow

Exit criteria:

- Aviation maintenance questions can be routed safely without making aviation hardcoded into the core platform.

## First Sprint

Build only Stage 0 and Stage 1.

Initial milestone:

```text
A polished document dashboard where users can upload PDFs, view documents, tag them, and inspect document metadata.
```

Do not start with chat. Chat depends on ingestion, citations, search, review status, and validated knowledge.

## MVP Demo Target

The first demo should use one aviation PDF and one non-aviation PDF.

Demo flow:

```text
1. Upload both PDFs.
2. Show document library and metadata.
3. Run extraction.
4. Review generated topics.
5. Approve selected topics.
6. Export OKF Markdown.
7. Open the Knowledge bundle explorer and preview the exported OKF file, index, manifest, and log.
8. Ask a direct question that uses OKF.
9. Ask an open-ended question that uses RAG.
10. Ask a mixed question that uses Hybrid only when needed.
11. Show citations, router decision, retrieval mode, evidence card, and trace.
```

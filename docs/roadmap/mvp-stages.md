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
- Confidence is categorical: `high` for clear heading boundaries, `low` for coarse page-range fallback, and `medium` is reserved for later mixed-boundary heuristics.
- `sourcePageNumbers` is the page coverage field that Stage 5 OKF export will consume.

Exit criteria:

- A user can inspect generated topic records and mark them for review, approval, rejection, or cleanup.

## Stage 4: Search And RAG

Purpose: support broad discovery across raw and semi-structured content.

RAG indexing happens immediately after extraction and does not wait for human review. RAG is allowed to index raw and unapproved content, but that content must retain source and review-status labels.

Deliverables:

- Chunk generation
- Keyword search
- Vector search
- Hybrid retrieval
- Source filters
- Citation objects
- Search UI

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
- OKF-to-RAG coverage links
- Bundle validation
- Deterministic link lint for relative Markdown graph links and relation targets
- Deterministic relation lint for relation enum values, target resolution, and target type matching
- GitHub Actions `okflint validate` CI gate
- OKF preview UI

Exit criteria:

- Approved topic records export into valid OKF-style Markdown files with source references.
- Internal graph links resolve under the AV-OKF link-resolution profile.
- Approved OKF concepts can identify the RAG chunks and source pages they govern.
- Operational links use typed relations such as `routes_to`, `references`, `supports`, `covered_by`, `supersedes`, and `conflicts_with`.
- Relation targets declare a `target_type` that matches the resolved target file's frontmatter `type`.
- MVP-02 is enforced by `okflint validate --manifest okf-base.yaml`, not a custom schema checker.

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

Exit criteria:

- A user can ask questions and see whether the router sent the query to OKF, RAG, Hybrid, or missing-context handling.
- Agent traces show the router category, route, confidence, and rationale.
- Hybrid retrieval is demonstrably not the default path.

Architecture note:

- [Query Router](../architecture/query-router.md)

## Stage 7: Validation

Purpose: prevent unsupported or misleading answers by validating generated claims against citations, source authority, review status, and domain rules.

Deliverables:

- Claim extraction
- Claim typing and risk classification
- Citation validation
- Evidence-to-claim matching
- Source-access validation
- Review-status validation
- Domain rule hooks
- Source authority matrix
- Confidence thresholds
- Blocked claim reporting
- Safe answer modes: release, rewrite with limitations, missing evidence, clarify, or refuse
- Agent trace persistence

Exit criteria:

- Unsupported claims are blocked or clearly labeled, and every answer has an inspectable trace.
- Validation reports show extracted claims, claim types, supporting sources, authority results, confidence, and blocked claims.
- High-risk claims require direct support from approved authoritative sources.
- When approved OKF conflicts with raw RAG evidence, the validator trusts approved OKF and records the RAG conflict.
- Validation distinguishes route, support, reference, supersession, and conflict links instead of treating all Markdown links as equal.

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
7. Ask a direct question that uses OKF.
8. Ask an open-ended question that uses RAG.
9. Ask a mixed question that uses Hybrid only when needed.
10. Show citations, router decision, retrieval mode, and trace.
```

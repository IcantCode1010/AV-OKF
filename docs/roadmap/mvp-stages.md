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

Exit criteria:

- An uploaded PDF produces page-level extracted text and source page references.

## Stage 3: Topic Records

Purpose: turn extracted pages into reviewable knowledge candidates.

Deliverables:

- Topic boundary detection
- Topic record schema
- Topic title, type, summary, page range, and source references
- Confidence score
- Review status
- Topic review UI

Exit criteria:

- A user can inspect generated topic records and mark them for review, approval, rejection, or cleanup.

## Stage 4: Search And RAG

Purpose: support broad discovery across raw and semi-structured content.

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

## Stage 5: OKF Bundle

Purpose: turn approved topic records into structured agent-readable knowledge.

Deliverables:

- Knowledge object model
- OKF frontmatter schema
- Markdown exporter
- `index.md` generation
- `source_manifest.md` generation
- Bundle validation
- OKF preview UI

Exit criteria:

- Approved topic records export into valid OKF-style Markdown files with source references.

## Stage 6: Chat Agent

Purpose: let users ask questions across the document collection.

Deliverables:

- Chat sessions
- Chat messages
- Query router
- Query classification: canonical, open-ended, comparison, source lookup, high-risk domain, or missing context
- OKF retrieval tool
- RAG retrieval tool
- Hybrid retrieval mode only when both curated knowledge and raw evidence are needed
- Answer builder
- Citation renderer
- Agent trace drawer

Exit criteria:

- A user can ask questions and see whether the router sent the query to OKF, RAG, Hybrid, or missing-context handling.

## Stage 7: Validation

Purpose: prevent unsupported or misleading answers.

Deliverables:

- Claim extraction
- Citation validation
- Source-access validation
- Review-status validation
- Domain rule hooks
- Blocked claim reporting
- Agent trace persistence

Exit criteria:

- Unsupported claims are blocked or clearly labeled, and every answer has an inspectable trace.

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

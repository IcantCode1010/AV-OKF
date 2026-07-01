# AV-OKF

AV-OKF is a document intelligence platform concept for turning uploaded documents into structured, reviewable knowledge that AI agents can search, cite, and reason over.

The project starts from an aviation maintenance use case, but the core platform is intended to be generic: any document collection should be ingestible, searchable, structured into OKF-style knowledge, and usable through an agentic chat interface.

## Product Idea

Most document chat tools stop at retrieval over chunks. AV-OKF separates the knowledge system into three layers:

```text
RAG = broad discovery across raw documents
OKF = curated, structured, stable knowledge
Tools/APIs = live state and actions
```

The agent should route each question before retrieval:

- Use OKF for direct, stable, source-backed answers.
- Use RAG for open-ended discovery, summaries, and cross-document search.
- Use Hybrid only when the answer needs both a curated concept and supporting raw evidence.
- Use tools/APIs for live or frequently changing data.

## First Domain Pack

Aviation maintenance is the first domain pack because it requires strict source authority, effectivity, citations, and validation.

The initial aviation concept focuses on:

- Boeing 737NG technical knowledge
- ATA classification
- Manual routing
- Source manifests
- Fault routes
- Evidence validation
- Human review before trusted answers

The platform should remain generic while aviation proves that the architecture works under high-trust constraints.

## Core Workflow

```text
Upload documents
-> Extract pages, text, tables, and images
-> Generate topic records
-> Review and approve structured knowledge
-> Export approved knowledge to OKF Markdown
-> Index raw and structured content for RAG
-> Route each chat question to OKF, RAG, Hybrid, or missing-context handling
-> Validate claims and show citations
```

## Repository Contents

```text
docs/
  product-requirements/
    AV-OKF_Agentic_Maintenance_Triage_PRD.md
  roadmap/
    mvp-stages.md
```

## Current Status

This repository contains planning artifacts, OKF validation tooling, and the first web application shell.

The current engineering milestone is a Papra-style document vault:

```text
workspace shell
document dashboard
PDF upload
document metadata
tags
document detail page
processing status
page extraction records
extraction logs
topic records
topic review status
```

## Web App

The Stage 3 product shell lives in `apps/web`.

```bash
pnpm --dir apps/web dev
pnpm --dir apps/web lint
pnpm --dir apps/web build
```

The app uses mock auth plus a local Stage 1 document vault. PDFs upload through Server Actions, files are written under opaque storage keys, metadata is editable, and document state is persisted in `apps/web/.data/document-vault.json`.

`apps/web/.data/` is intentionally ignored by git. This JSON file store is a temporary Stage 1 stand-in so the product flow can work before a real database and object store are selected. Do not treat it as the long-term backend.

Stage 2 adds local in-process PDF extraction. Upload returns immediately, extraction runs in the same long-lived Node process, and the document detail page polls while extraction is queued or running. This is an MVP-only background job model and must be replaced with a durable queue or worker before serverless or production deployment.

Stage 3 adds manual topic generation from extracted page records. It does not run automatically after re-extraction. Reruns replace draft topics, preserve approved or rejected topics, and skip regenerated drafts that overlap reviewed page coverage. Topic confidence is categorical, not numeric, and `sourcePageNumbers` is the page coverage field that later OKF export should consume.

### Docker/VPS Deployment

Stage 3.5 supports a single-node Docker deployment for demos and VPS hosting.

```bash
docker compose build
docker compose up -d
```

The container listens on `0.0.0.0:3000` and exposes a health check at:

```text
http://localhost:3000/api/health
```

Docker uses `AV_OKF_DATA_ROOT=/data`. The Compose file mounts the named volume `av-okf-data` at `/data`, which must persist:

```text
/data/document-vault.json
/data/uploads/
```

Do not run the Docker container without a persistent `/data` mount unless the deployment is disposable. Without the volume, uploaded PDFs, extracted page records, topic records, and metadata are lost when the container is replaced.

This is a single-container MVP deployment model. Do not run multiple replicas against the same JSON vault. Before serverless, multi-container, or public production deployment, replace the JSON vault with a real database/object store and replace in-process extraction with a durable queue or worker.

## Design Principles

- Build the generic document platform first.
- Treat aviation as a domain pack, not as hardcoded core behavior.
- Preserve source page references throughout ingestion.
- Keep raw extraction separate from approved knowledge.
- Make review status visible.
- Put a query router in front of OKF and RAG.
- Require citations for agent answers.
- Let the agent say "missing evidence" instead of guessing.
- Store curated knowledge in Markdown so it can be reviewed in Git.

## Key Documents

- [Product Requirements Document](docs/product-requirements/AV-OKF_Agentic_Maintenance_Triage_PRD.md)
- [MVP Stages Roadmap](docs/roadmap/mvp-stages.md)

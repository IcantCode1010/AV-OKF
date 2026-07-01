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
```

## Web App

The Stage 0 product shell lives in `apps/web`.

```bash
pnpm --dir apps/web dev
pnpm --dir apps/web lint
pnpm --dir apps/web build
```

The shell uses mock auth and seeded demo documents. Stage 1 will add PDF upload, storage, editable metadata, tags, and processing state backed by real data.

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

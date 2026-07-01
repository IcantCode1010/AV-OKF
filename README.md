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

This repository contains planning artifacts, OKF validation tooling, the first web application shell, and an initial production data-plane path for Docker/VPS deployment.

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

By default, local development still uses mock auth plus the local Stage 1 document vault. PDFs upload through Server Actions, files are written under opaque storage keys, metadata is editable, and document state is persisted in `apps/web/.data/document-vault.json`.

`apps/web/.data/` is intentionally ignored by git. This JSON file store is a temporary Stage 1 stand-in so the product flow can work before a real database and object store are selected. Do not treat it as the long-term backend.

Stage 2 adds local in-process PDF extraction. Upload returns immediately, extraction runs in the same long-lived Node process, and the document detail page polls while extraction is queued or running. This is an MVP-only background job model and must be replaced with a durable queue or worker before serverless or production deployment.

Stage 3 adds manual topic generation from extracted page records. It does not run automatically after re-extraction. Reruns replace draft topics, preserve approved or rejected topics, and skip regenerated drafts that overlap reviewed page coverage. Topic confidence is categorical, not numeric, and `sourcePageNumbers` is the page coverage field that later OKF export should consume.

### Stage 4 RAG Search

Stage 4 indexes extracted page records into retrieval-sized chunks. Production uses OpenAI `text-embedding-3-small` and Postgres + pgvector. Local tests use deterministic embeddings and never require an API key.

RAG chunks are independent from OKF topics. RAG chunks optimize retrieval; OKF topics optimize human-reviewed meaning.

Embedding budget caps are enforced before any OpenAI API call. If a cap is exceeded, indexing fails with `embedding_budget_exceeded`; the system does not truncate documents silently.

### Docker/VPS Deployment

Stage 3.6-3.9 moves the app toward a production VPS shape:

```text
caddy -> web
worker -> postgres + redis + minio
```

The Compose stack includes:

- `caddy` reverse proxy on host port `3000`
- `web` Next.js application container
- `worker` long-running extraction worker
- `postgres` for documents, metadata, extraction state, topics, activity, workspaces, and Auth.js records
- `redis` for BullMQ extraction jobs
- `minio` for S3-compatible PDF object storage
- `migrate` one-shot Prisma migration service

```bash
docker compose build
docker compose up -d
```

The app is reached through Caddy:

```text
http://localhost:3000/api/health
```

Production mode is enabled with:

```text
AV_OKF_BACKEND=production
```

In production mode, no app path writes `document-vault.json`. Uploaded PDFs go to MinIO under opaque scoped object keys like:

```text
workspaces/{workspaceId}/documents/{documentId}/original/{uuid}.pdf
```

Set OAuth credentials before using the production stack:

```text
AUTH_SECRET
AUTH_URL
NEXTAUTH_SECRET
NEXTAUTH_URL
AUTH_GITHUB_ID
AUTH_GITHUB_SECRET
AUTH_GOOGLE_ID
AUTH_GOOGLE_SECRET
```

At least one OAuth provider must be configured for users to sign in. On a public VPS, replace the demo passwords/secrets in `docker-compose.yml`, set `AUTH_URL`, `NEXTAUTH_URL`, and `APP_BASE_URL` to the public HTTPS origin, and change `apps/web/Caddyfile` from `:80` to your domain so Caddy can manage HTTPS certificates.

Postgres, Redis, and MinIO are not published to host ports by Compose. Only Caddy is public. Back up the named volumes `postgres-data` and `minio-data`; Redis persistence is enabled for durable BullMQ state but Postgres and MinIO are the primary long-term records.

This is still a single-node VPS architecture. Multiple web containers are possible after this data-plane migration, but multi-worker deployments must rely on BullMQ locking and idempotent job IDs. Serverless deployment still needs a managed database, managed object store, and durable queue/worker replacement.

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
- [VPS Production Deployment](docs/deployment/vps-production.md)

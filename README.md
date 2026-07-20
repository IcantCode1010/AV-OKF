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
-> Index raw extracted text for RAG discovery
-> Generate topic records
-> Review and approve structured knowledge
-> Export approved knowledge to OKF Markdown
-> Retrieve approved knowledge live from the OKF bundle
-> Route each chat question to OKF, RAG, Hybrid, or missing-context handling
-> Synthesize an evidence-bound answer and validate its citations
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

AV-OKF is a late-stage MVP with a working end-to-end document-to-agent pipeline and a workspace-scoped, multi-bundle knowledge vault.

The current system includes:

```text
Next.js document workspace
Postgres application state
MinIO PDF storage
Redis/BullMQ extraction and indexing worker
page-preserving PDF extraction
raw-document RAG with pgvector
reviewable and enrichable topic records
generic and aviation-derived OKF profile export
workspace-isolated knowledge bundles and bundle-scoped chats
live OKF bundle retrieval and typed-relation traversal
router-first chat with OKF, RAG, Hybrid, and missing-context paths
Vercel AI SDK answer synthesis
citations, evidence cards, traces, and deterministic evidence validation
```

The next milestone is the bounded Stage 7 agent-tool layer. Insufficient-evidence completion, reviewer-visible knowledge gaps, authenticated source-PDF page links, OKF concept links, and historical citation lifecycle notices are implemented. Unrestricted model-driven tool loops remain deliberately deferred.

## Web App

The web application lives in `apps/web`.

```bash
pnpm --dir apps/web dev
pnpm --dir apps/web lint
pnpm --dir apps/web build
```

The local JSON vault remains available as a development/test fixture. Production mode uses Postgres, MinIO, Redis/BullMQ, and the separate worker container; no production path writes `document-vault.json`.

`apps/web/.data/` is intentionally ignored by git. This JSON file store is a temporary Stage 1 stand-in so the product flow can work before a real database and object store are selected. Do not treat it as the long-term backend.

Local-vault mode can still use in-process extraction. The production backend uses the durable Redis/BullMQ queue and worker implemented in Stage 3.8.

Stage 3 adds manual topic generation from extracted page records. It does not run automatically after re-extraction. Reruns replace draft topics, preserve approved or rejected topics, and skip regenerated drafts that overlap reviewed page coverage. Topic confidence is categorical, not numeric, and `sourcePageNumbers` is the page coverage field that later OKF export should consume.

### OKF And Chat

Approved topics export into the document's selected bundle under `knowledge/workspaces/{workspaceId}/bundles/{bundleId}`. Uploads and chats require one bundle, and retrieval, relations, lifecycle state, RAG search, and exports stay inside it. The live chat path reads current bundle files on every OKF query; raw RAG remains the unreviewed discovery layer.

Generic OKF requires only `type`; `title`, `description`, `tags`, and `updated` are optional interoperable fields. Agent trust is a separate gate requiring active lifecycle, approval, usable content, and source-file/page provenance. Aviation and custom profiles extend the generic contract without changing its base semantics.

Create bundles from `/knowledge`. Existing single-bundle installations can inspect or apply the resumable migration with:

```bash
pnpm --dir apps/web migrate:knowledge-vault -- --workspace <workspace-id>
pnpm --dir apps/web migrate:knowledge-vault -- --workspace <workspace-id> --apply
```

Each Knowledge Bundle explorer provides a synchronized physical file tree, force-directed typed-relation graph, and rendered Markdown reader at `/knowledge/[bundleId]`. The explorer labels generic validity separately from agent readiness. Reviewed relation discovery creates pending candidates; only approved and re-exported relations enter frontmatter or graph traversal.

Chat uses deterministic routing first, with an LLM classifier only for low-confidence routes. OpenAI and Anthropic are supported through the Vercel AI SDK provider layer. Generated answers must use retrieved evidence and valid `[n]` citation markers or they fall back to a deterministic evidence response.

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

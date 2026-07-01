# VPS Production Deployment

This deployment target is a single VPS running Docker Compose:

```text
caddy
web
worker
postgres
redis
minio
```

It is not a serverless architecture and it is not a multi-node cluster.

## Required Secrets

Replace all demo values before public deployment:

```text
DATABASE_URL
REDIS_URL
S3_ENDPOINT
S3_REGION
S3_BUCKET
S3_ACCESS_KEY_ID
S3_SECRET_ACCESS_KEY
S3_FORCE_PATH_STYLE=true
AUTH_SECRET
AUTH_URL
NEXTAUTH_SECRET
NEXTAUTH_URL
AUTH_GITHUB_ID
AUTH_GITHUB_SECRET
AUTH_GOOGLE_ID
AUTH_GOOGLE_SECRET
APP_BASE_URL
```

At least one OAuth provider must be configured or production users cannot sign in.

## Startup

```bash
docker compose build
docker compose up -d
```

The `migrate` service runs `pnpm db:migrate` before `web` and `worker` start.

## Public Ports

Only Caddy should be exposed publicly.

Postgres, Redis, and MinIO are internal Compose services. Do not publish their ports on a public VPS unless you are deliberately doing an admin-only maintenance task behind firewall rules.

For a real domain, update `apps/web/Caddyfile` from:

```text
:80
```

to the public hostname. Caddy will then manage HTTPS certificates automatically.

## Persistence

Back up these named volumes:

```text
postgres-data
minio-data
```

Redis uses append-only persistence for BullMQ durability, but Postgres and MinIO are the source of truth for application state and uploaded PDFs.

## Current Limitations

- This is a single-node VPS deployment.
- Multi-worker extraction relies on BullMQ locking and deterministic job IDs, but should be load-tested before running multiple workers.
- Serverless deployment still requires replacing self-hosted services with managed Postgres, object storage, and a durable queue/worker platform.
- The local JSON vault is a development fallback only when `AV_OKF_BACKEND` is not `production`.

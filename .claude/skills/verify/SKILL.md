---
name: verify
description: How to stand up AV-OKF locally and drive the real app (not just tests) to verify a change.
---

AV-OKF's product surface is a Next.js web app (`apps/web`) backed by Postgres/Redis/S3 in
"production" mode. Most interesting features (chat, RAG search, OKF export) only run in
production mode — local dev mode (`AV_OKF_BACKEND` unset) uses a JSON-file vault and explicitly
disables chat entirely. To verify a change end-to-end you almost always need production mode
against a real (can be throwaway/local) Postgres.

## Fast path: Postgres + Redis in Docker, Next dev server on the host

No need to build the full Docker Compose stack (web/worker/caddy/minio) for most verification —
`next dev` on the host against containerized Postgres/Redis is much faster to iterate on.

```bash
docker run -d --name verify-postgres -e POSTGRES_DB=av_okf -e POSTGRES_USER=av_okf \
  -e POSTGRES_PASSWORD=av_okf -p 55432:5432 pgvector/pgvector:pg17
docker run -d --name verify-redis -p 56379:6379 redis:8-alpine
# wait for postgres: docker exec verify-postgres pg_isready -U av_okf
```

In `apps/web`, create a throwaway env file (values must be quoted if they contain spaces — a bare
`source` on an unquoted multi-word value will run the words as shell commands):

```bash
cat > .env.verify <<'EOF'
AV_OKF_BACKEND=production
DATABASE_URL=postgresql://av_okf:av_okf@localhost:55432/av_okf
REDIS_URL=redis://localhost:56379
AUTH_SECRET=verify-local-secret
NEXTAUTH_SECRET=verify-local-secret
AUTH_URL=http://localhost:3100
NEXTAUTH_URL=http://localhost:3100
APP_BASE_URL=http://localhost:3100
AV_OKF_SETTINGS_ENCRYPTION_KEY=verify-local-32-byte-settings-k
AV_OKF_MANIFEST_PATH=../../okf-base.yaml
AV_OKF_KNOWLEDGE_ROOT=../../knowledge
AV_OKF_TEST_AUTH_ENABLED=true
AV_OKF_TEST_AUTH_EMAIL=test@av-okf.local
AV_OKF_TEST_AUTH_PASSWORD=verify-local-test-password
AV_OKF_TEST_AUTH_NAME="AV-OKF Verify User"
EOF

set -a; source .env.verify; set +a
node_modules/.bin/prisma migrate deploy   # applies prisma/migrations against the container
node_modules/.bin/next dev -p 3100 &      # AV_OKF_TEST_AUTH_ENABLED unlocks credentials login
```

Sign in at `http://localhost:3100/api/auth/signin/credentials` with the `AV_OKF_TEST_AUTH_*`
creds above — this bypasses needing real GitHub/Google OAuth and auto-provisions a default
workspace on first login (`ensureDefaultWorkspace` in `src/lib/auth.ts`).

Clean up after: `docker rm -f verify-postgres verify-redis`, delete `.env.verify`, `git checkout
apps/web/tsconfig.json` (Next.js rewrites its `include` array on first dev-server boot — this is
not a real change, just revert it), `rm -rf apps/web/.next`.

## Driving the browser

Playwright works well for this (`npx playwright install --with-deps chromium` if not cached, then
`npm install playwright` in a scratch dir so `import { chromium } from "playwright"` resolves).
Log in via the credentials form, then drive pages directly by URL (`/chat`, `/documents`, etc.).

## Known environment gaps (not bugs in your diff — don't re-report these)

- **No real OpenAI key available in this sandbox.** `AV_OKF_BACKEND=production` always uses the
  real OpenAI embedding provider (`embedding-provider.ts` only falls back to the deterministic
  test provider outside production mode) — so any RAG vector/hybrid search will throw
  `missing_env_OPENAI_API_KEY` unless a real key is exported. This is realistic (it's exactly what
  happens in a misconfigured/rate-limited production deployment), so it's actually a good forcing
  function for testing error paths, not just a blocker — but it means you can't observe the
  "citations found" happy path live without a real key; lean on unit tests (mocked retrieval) for
  that part and use the live run to check failure/degradation behavior instead.
- **Chat message thread has no auto-scroll-to-bottom** (`chat-thread.tsx` / the session page's
  `overflow-y-auto` container defaults to `scrollTop: 0` on load). The newest message is genuinely
  in the DOM and in Postgres — it's just below the fold. A `fullPage` Playwright screenshot will
  *not* reveal this by itself, since it only captures the page's own height, not scrolled state of
  a nested `overflow-y-auto` div; you have to manually scroll that element
  (`document.querySelector(".overflow-y-auto").scrollTop = ...scrollHeight`) to see the latest
  reply. Worth fixing at some point but pre-existing — don't attribute it to whatever you're
  currently verifying unless you touched `chat-thread.tsx` or the session page's layout.

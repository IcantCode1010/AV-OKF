# Shared knowledge migration and recovery

The refactor uses additive schema migration `20260906010000_shared_knowledge_platform`. It adds research, article/revision, visual, EFB-selection, and export records plus recipe snapshots and research mode. Legacy source and topic tables remain intact.

## Verified local baseline

The baseline at `C:/projects/av-okf-backups/20260905-refactor` contains PostgreSQL (`database.dump`), original/derived object storage (`minio.tar`), native knowledge (`knowledge.tar`), and retained exports (`releases.tar`). PostgreSQL was restored to an isolated container; storage archives were extracted and compared against their contents. The additive migration was tested on the restored database before application to the local database.

The idempotent backfill retained 2 documents, 226 topic identities/approval/export references, and 37 existing conversations/scopes, and produced 230 shared revision snapshots. Re-running it preserved their bodies, evidence, and approvals. Subsequent verification sessions can increase the conversation count without altering that baseline.

## Commands

Run Docker commands from the AV-OKF repository root:

```powershell
docker compose build web
docker compose run --rm --no-deps --entrypoint node web node_modules/prisma/build/index.js migrate deploy
docker compose run --rm --no-deps --entrypoint node web --import tsx scripts/migrate-shared-knowledge.mts <workspace-id>
docker compose up -d web worker
```

The backfill command verifies legacy identities and checks that running the import twice produces the same shared snapshots. It does not invent missing source quotes or approval records.

Run verification against a local configured workspace:

```powershell
docker compose run --rm --no-deps --entrypoint node web --import tsx scripts/verify-shared-knowledge.mts
docker compose run --rm --no-deps --entrypoint node web --import tsx scripts/verify-shared-knowledge.mts --live
docker compose run --rm --no-deps --entrypoint node web --import tsx scripts/verify-shared-knowledge.mts --graph
docker compose run --rm --no-deps --entrypoint node web --import tsx scripts/verify-shared-knowledge.mts --media
docker compose run --rm --no-deps --entrypoint node web --import tsx scripts/verify-shared-knowledge.mts --export
docker compose run --rm --no-deps --entrypoint node web --import tsx scripts/verify-shared-knowledge.mts --chat
docker compose run --rm --no-deps --entrypoint node web --import tsx scripts/verify-shared-knowledge.mts --diagram --reuse
docker compose run --rm --no-deps --entrypoint node web --import tsx scripts/verify-shared-knowledge.mts --eval
docker compose run --rm --no-deps --entrypoint node web --import tsx scripts/verify-shared-knowledge.mts --briefs
```

The live, graph, chat, evaluation, and brief options use the configured provider and incur normal model usage. Fixtures are clearly fictional and cleaned up after the run. The export check uses an ephemeral test signing key and only its own selected fixture revision.

## Recovery sequence

For an application regression, turn off the affected workflow flags and recreate web/worker containers. Do not delete new tables or roll the database backward merely to restore the earlier UI.

For data recovery, stop writers first. Restore the database and matching storage/export snapshots into isolated replacement resources, compare source/approval/export counts and hashes, and only then switch the services to those resources. Never restore over an active database or copy one release's database together with another release's object storage.

Keep signing keys in a separate protected backup when real publishing is configured. Retain prior source snapshots and exports. A historical export is an audit artifact; downloading or re-exporting through the app still checks current source availability.

# Push to EFB app

“Push to EFB app” means uploading the completed signed OKF package through
Project EFB's authenticated publisher into Supabase, importing and verifying
it, then activating the catalog so authorized EFB users can access it.
Downloading a package is optional and does not publish it.

Use the Push to EFB app button beside a completed package in EFB selections.
The existing release runner saves each completed stage; failed delivery can be
retried from the same package. Repeated clicks reuse one run. Other logical
packages remain in the catalog; a newer version of the same logical package
replaces its earlier version. Concurrent catalog changes block activation.

## Deployment prerequisites

1. Deploy Project EFB migration `20260911000100_okf_additive_publication.sql`
   and its updated `api/publish.ts`. Existing authorization and trusted signing
   key requirements still apply.
2. Configure `EFB_PUBLISHER_URL` (the EFB `/api/publish` endpoint) and either:
   - `EFB_PUBLISHER_AUTH_URL`, `EFB_PUBLISHER_PUBLIC_KEY`,
     `EFB_PUBLISHER_EMAIL`, and `EFB_PUBLISHER_PASSWORD` for an authorized
     publisher account. The server signs in, caches the session during a run,
     and renews expired/rejected sessions automatically.
   - `EFB_PUBLISHER_TOKEN` for temporary manual operation. This takes precedence
     over account credentials and requires manual renewal when expired.
   Keep credentials in the ignored web/worker environment, never in client
   variables or git. Private packages also require `EFB_PRIVATE_ORGANIZATION_ID`.
3. Configure `AV_OKF_EFB_SIGNING_KEY_PATH` and `AV_OKF_EFB_SIGNING_KEY_ID`
   in the Docker Compose environment. The receiver must trust the matching
   public key. Previously unsigned packages must be rebuilt; do not bypass
   signature validation or relabel an unsigned package as ready for delivery.
4. Rebuild/restart the AV-OKF web and worker services.

## Configured environment — 2026-09-11

The receiver migration and updated API are deployed to the linked
`project-efb-mx-test` Supabase project and Project EFB Vercel production app.
The local Docker web/worker now use the existing authorized publisher account
with automatic sign-in. Signing uses the existing approved EFB publication
key, mounted read-only from the EFB checkout. Secrets remain outside git.

An authenticated `inspect` call from the running worker succeeded. The deployed
additive action rejected a nonexistent package as expected, before any release
creation. The latest two local packages were unsigned and require rebuilding.
No package was uploaded or activated during configuration. This connection
check is not an end-to-end publication test.

## Local verification

Project EFB server type checking and all 13 server tests passed. A rolled-back
PostgreSQL fixture exercised the new migration functions: preservation of an
unrelated Boeing package, replacement of an older Airbus version, rejection of
stale activation, and idempotent activation retry all passed. This isolated
fixture used mock publisher authorization and does not replace a full Supabase
authorization/integration test after deployment.

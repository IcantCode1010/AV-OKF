# Implementation report: Unified OKF Release Pipeline (PoC)

## Outcome

AV-OKF now has one article-revision-based EFB classification and release path,
a resumable `KnowledgeReleaseRun`, a profile-driven navigation compiler, native
OKF navigation materialization, and a dry-run-first HTTP publisher for Project
EFB's existing receiver. New automatic authoring work no longer creates
`EfbReleaseJob` rows; historical rows remain executable for compatibility.

## Acceptance criteria

- [x] One traceable resumable release-run model: `KnowledgeReleaseRun` records ordered completed stages and resumes without repeating them.
- [x] Article revisions are the sole new publishable input: automatic authoring imports legacy topics into `KnowledgeArticleRevision` and selections reference approved revisions.
- [x] One classification persistence path: new automatic work uses `KnowledgeEfbClassification` and a pinned registry hash.
- [x] Navigation root, hubs, and reachability: compiler and six-topic integration tests verify all selected technical articles are reachable.
- [x] Existing Project EFB receiver contract: publisher uses only authenticated `POST /api/publish` actions and creates no receiver schema.
- [x] Rollback is pointer-only: `rollbackEfbRelease` sends only `activate` for a retained revision.
- [x] Six controlled fixtures: two each for 737NG, 737MAX, and A319/A320 pass classification, compilation, signed packaging, mocked import, and activation.
- [ ] Live development activation and real curator-document rollout: blocked by absent Project EFB receiver URL/token, publisher enrollment, trusted signing key, and selected real documents.
- [x] Default repository checks pass.

## Changes

- `apps/web/prisma/schema.prisma` and `20260909120000_unified_knowledge_release_run`: additive resumable release model.
- `apps/web/src/lib/knowledge/release-run.ts`: workspace-scoped stage orchestration with registry drift checks and explicit publication/activation waits.
- `apps/web/src/lib/knowledge/efb-workflow.integration.test.mts`: database-backed proof of full completion, crash recovery without repeated completed stages, and single-winner concurrent claiming.
- `apps/web/src/lib/knowledge/export.ts`: reuses existing preflight and package builder for unified runs and integrates selected navigation profiles.
- `apps/web/src/lib/navigation/`: reusable classification, root/hub generation, portable links, relation compilation, graph validation, reporting, and OKF materialization.
- `apps/web/src/lib/efb-publisher/` and `apps/web/scripts/publish-efb-package.mts`: package inspection, dry-run plan, resumable receiver actions, activation, and rollback.
- `apps/web/src/lib/knowledge-authoring.ts` and `efb-release-automation.ts`: route new automatic work through article revisions and unified runs while preserving historical job execution.
- Architecture, roadmap, changelog, and six-topic verification documentation updated.

## Deviations from proposal

The automated six-topic test uses a mocked Project EFB HTTP receiver because no
local Project EFB receiver or publisher credentials are configured. The real
curator-document rollout check was not run because documents were not selected.
Both are reported as external rollout gates rather than represented as passing.

## Verification

| Command or check | Result | Evidence or notes |
|---|---|---|
| `pnpm --dir apps/web lint` | PASS | ESLint completed with no findings. |
| `pnpm --dir apps/web test` | PASS | 860 Node tests passed, 5 skipped; 19 component tests passed, including the database-backed release-run scenarios. |
| `pnpm --dir apps/web build` | PASS | Next.js production build and TypeScript check completed. |
| `python -m unittest discover -s tests -p test_okf_relation_lint.py` | PASS | 5 tests passed. |
| `python tools/okf_relation_lint.py --manifest okf-base.yaml` | PASS | Zero violations. |
| Six-topic integration test | PASS | Six classifications, 6/6 reachability, nine-entry schema 2.1 package, mocked activation. |
| Database-backed release-run integration | PASS | Full eight-stage completion, partial failure/resume with the completed gate executed once, and concurrent claim rejection with the gate executed once. |
| Live Project EFB controlled staging | PASS | Signed 15-article package validated and imported; candidate inspected and intentionally left inactive pending explicit activation. |

## Controlled publication follow-up

The deployed receiver accepted and validated a 15-article ATA 27 package after
two receiver-discovered compatibility corrections: generated empty hubs now
meet content-quality limits, and navigation summary data remains in
`native/navigation-report.json` instead of an unsupported top-level manifest
property. Supabase contains 25 entries, 78/78 verified artifacts, 63 links, and
25 retrieval documents. Release `686d1fee-bf97-4ba4-9787-de87924bb81f` was
explicitly activated after inspection. An authenticated B738 maintenance search
through `/api/efb` returned newly published content from that release. Prior
release `305e7ff4-ae3e-45ea-a452-94e935be1752` remains the rollback target.

## Baseline comparison

The full supported test, lint, build, and Python checks pass. Standalone
`tsc --noEmit` continues to report pre-existing test-fixture typing errors and
is not a repository default gate; the production build's TypeScript check
passes.

## Known limitations and remaining risks

- Live receiver behavior still requires the provisioned Project EFB development environment.
- ATA 27 is the committed production profile; ATA 29 and QRH modularity are automated fixtures rather than shipped profiles.
- Title-keyword profile rules are a lowest-priority fallback and may require curator assignment for unmatched or ambiguous titles.

## Manual review instructions

1. Run the default validation commands in `AGENTS.md`.
2. Run `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types --test src/lib/knowledge/six-topic-release.integration.test.mts` from `apps/web`.
3. Set `AV_OKF_NAVIGATION_PROFILE_ID=737-flight-controls` and version `1`, then create a unified run from approved selected ATA 27 revisions.
4. Without receiver credentials, confirm it stops at `awaiting_publication` after producing a validated package.
5. In a provisioned development environment, resume publication without activation, inspect the candidate, then explicitly resume with activation enabled; activate the prior retained revision to verify rollback.

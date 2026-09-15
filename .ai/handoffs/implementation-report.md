# Implementation report: Coherent multi-source OKF Topic Builder

## Outcome

Topic Builder can now produce one structured, source-grounded OKF topic from already-indexed documents using RAG by default, with full scan as an explicit option. It keeps evidence gaps, applicability exclusions, source/page/hash provenance, cross-source differences, and reviewer decisions visible. Existing legacy runs and exports remain supported.

## Acceptance criteria

- [x] Use indexed evidence without re-ingestion or entity re-extraction; RAG is the default and full scan remains selectable.
- [x] Produce a single coherent topic with fixed sections, per-lens evidence notes, persisted excluded evidence, narrative word cap, traceable source table, and verbatim cited numeric limits.
- [x] Preserve source differences and require reviewer-confirmed typed reasons before approval; require explicit review of procedure-purpose notes.
- [x] Reject missing required evidence, invalid/stale citations, excessive prose, unsupported values, and unreviewed differences instead of silently truncating or dropping claims.
- [x] Keep native OKF single-topic export and legacy multi-article run/export compatibility.
- [x] Update roadmap and changelog as the implementation landed.
- [ ] Multi-document live/model integration run through approval, export, and refresh was not run; it requires configured model/infrastructure and real indexed evidence. Unit and repository suites pass.

## Changes

- `apps/web/src/lib/topic-builder-core.ts`: coherent result schema, evidence validation, applicability classification, evidence-lens status, stale-source checks, review state, and native single-topic export; legacy renderer remains available.
- `apps/web/src/lib/topic-builder.ts`: RAG-first generation, lens-guided retrieval, selected-scope applicability audit, source fingerprint/hash checks, bounded regeneration, and approval gates.
- `apps/web/src/components/coherent-topic-review.tsx` and `apps/web/src/app/(app)/topic-builder/`: structured review UI, visible evidence gaps and excluded evidence, mandatory difference-reason confirmation, and procedure-purpose review.
- `apps/web/src/lib/knowledge/editorial.ts` and `research.ts`: coherent revision import and inherited document/page applicability.
- `apps/web/prisma/schema.prisma` and `apps/web/prisma/migrations/20260915120000_coherent_topic_builder_defaults/migration.sql`: new recipe defaults use RAG and a 1,000-word narrative target; migration changes defaults only and does not alter existing rows.
- `apps/web/src/lib/topic-builder-core.test.mts`: focused tests for citations, numeric values, procedure limits, differences, applicability, evidence states, stale hashes, and explicit review.
- `CHANGELOG.md` and `docs/roadmap/mvp-stages.md`: record shipped behavior and remaining applicability limitations.

## Deviations from proposal

The repository's `.ai/handoffs/change-proposal.md` describes the unrelated Unified OKF Release Pipeline. The implementation followed the separate coherent-topic plan explicitly approved in the conversation; the existing proposal and earlier implementation report were preserved. The repository currently has document-level applicability but no chapter-level applicability field, so chapter inheritance could not be implemented without broadening the data model beyond this plan. The requested live multi-document model run remains unverified in this environment.

## Verification

| Command or check | Result | Evidence or notes |
|---|---|---|
| `pnpm --dir apps/web lint` | PASS | ESLint completed without errors. |
| `pnpm --dir apps/web test` | PASS | Full web suite; 902 tests, 897 passed, 5 skipped, 0 failed. |
| `$env:AV_OKF_TEST_AUTH_ENABLED='false'; pnpm --dir apps/web build` | PASS | Production build and TypeScript checks completed. |
| `pnpm --dir apps/web db:generate` | PASS | Prisma Client generated from updated schema. |
| `python -m unittest discover -s tests -p test_okf_relation_lint.py` | PASS | 5 tests passed. |
| `python tools/okf_relation_lint.py --manifest okf-base.yaml` | PASS | 0 violations. |

## Baseline comparison

No new test, lint, type-check, build, or relation-lint failures observed. The Python unittest command specified in `AGENTS.md` does not import as written in this Windows checkout; the equivalent discovery command above passes.

## Known limitations and remaining risks

- Applicability inheritance can use indexed page and document metadata, but chapter-level applicability is not represented in the current data model.
- Automated generation and approval were not exercised against a live multi-document corpus or paid model; perform that controlled integration review before enabling the workflow for production use.
- Procedure-purpose content is intentionally a reviewer responsibility; automated checks only enforce length and structure and do not claim to detect all operational instructions.

## Manual review instructions

1. Create a recipe over multiple already-indexed documents, leave research mode on RAG, and generate the topic. Confirm lens evidence states and excluded evidence are visible.
2. Review the Scope, System overview, limits, differences, and Sources. Confirm each narrative paragraph has one source tag, and numeric values appear in cited table rows.
3. For multiple contributing documents, select and confirm a reason for every difference. Confirm procedure-purpose text if present, then approve.
4. Change/reindex a cited source and refresh the page; the run should become non-approvable with the stale citation identified. Export the approved run and verify the native OKF topic and source records.

---

> Latest chat-cleanup implementation: [report](chat-cleanup-implementation-report.md). The earlier pipeline report below is preserved.

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

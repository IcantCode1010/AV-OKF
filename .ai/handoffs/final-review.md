# Independent implementation review: Controlled-publish follow-up (unified OKF release pipeline)

## Verdict

`APPROVED`

## Acceptance-criteria assessment

This follow-up targets two receiver-discovered compatibility issues found during the controlled live-publish check documented in the base commit `7c0fceb`, not new acceptance criteria of its own. Assessed against the two problems the user described:

| Criterion | Status | Evidence |
|---|---|---|
| Generated empty hubs meet the receiver's 80-character content-quality gate | PASS | `apps/web/src/lib/navigation/generate-hubs.ts` now injects a per-hub introduction sentence (`This generated navigation page groups approved knowledge entries for ${hub.title} within ${profile.root.title}.`) before the child-link list, so a hub with zero children still produces body content. New test `apps/web/src/lib/navigation/materialize-package.test.mts` ("generated empty hubs still satisfy package content quality") builds a profile with a hub matching no articles and asserts the rendered body is `>= 80` characters — matching the gate width implied by the report. The existing non-empty-hub test in the same file was also updated to assert the `>= 80` length. |
| Navigation summary is not exposed as an unsupported top-level manifest property, while remaining a declared native artifact | PASS | `apps/web/src/lib/efb-release-export.ts` removes the `navigation` field from the `manifest.json` object entirely (was previously spread onto the manifest under `input.navigation`). The navigation report is still written via the pre-existing `artifacts.set("native/navigation-report.json", stableJson(input.navigation.report))` (line 236, unchanged by this diff) and is included in the `nativeArtifacts` inventory list at line 256 because that list is built from every artifact key prefixed `native/` — so the report remains a declared native artifact, just not a top-level manifest field. `six-topic-release.integration.test.mts` was updated to assert `"navigation" in exported.manifest` is `false` and to instead read `native/navigation-report.json` from disk and check `technicalArticleCount === 6`, directly proving the new location works end to end. |
| No other code depended on the removed `manifest.navigation` field | PASS | Repo-wide search for `manifest.navigation`, `.navigation?.`, and `EfbNavigationMetadata` finds only the type definition and the `report`-augmented type in `efb-release-export.ts` itself — no other production or test code reads the removed field. |
| Package still validated and imported against the live receiver as an inactive candidate | PASS (per report) | `.ai/handoffs/implementation-report.md` and `docs/architecture/efb-publisher-contract-status.md` ("Controlled Development Candidate (2026-09-09)") both record candidate release `686d1fee-bf97-4ba4-9787-de87924bb81f` (15 articles, one root, nine hubs, 78 verified artifacts, 63 links, 25 retrieval documents) validated and imported with the retained release `305e7ff4-ae3e-45ea-a452-94e935be1752` still active and untouched — consistent with the proposal's "rollback/activation is pointer-only, no re-import" requirement. This is an external-system claim I cannot independently re-verify from the checkout, but it is internally consistent with the code changes that were required to get past validation (empty-hub content length, manifest schema property) and is reported as PASS rather than fabricated. |
| Documentation and changelog updated to reflect the fix and the candidate state | PASS | `docs/architecture/efb-publisher-contract-status.md` gained the "Controlled Development Candidate (2026-09-09)" section; `CHANGELOG.md` Unreleased gained a matching entry; `.ai/handoffs/implementation-report.md`'s verification table and a new "Controlled publication follow-up" section were updated together, consistent with each other. |

## Findings

No supported findings.

The only discrepancy worth noting for completeness — not a defect — is that the implementation report's test count moved from "861 Node tests passed, 3 skipped" (prior report state) to "860 Node tests passed, 5 skipped." No test files were added or removed by this diff (only two existing test files were edited: `six-topic-release.integration.test.mts` and `materialize-package.test.mts`, and the latter only gained one new `test(...)` block, which would increase rather than decrease the pass count). The knowledge test suite contains pre-existing conditional `skip` logic keyed on database/environment availability (`efb-workflow.integration.test.mts`, `article-version-migration.test.mts`), so a 1-passed/2-skipped shift is consistent with local environment/DB availability varying between runs, not with this diff removing or disabling a test. This does not rise to a finding because it does not indicate a regression introduced by the reviewed changes.

## Verification performed

| Command or check | Result | Notes |
|---|---|---|
| `git diff 7c0fceb --stat` / full diff of changed files | PASS (read-only review) | Confirmed the diff is limited to the two documented fixes (hub content quality, manifest navigation property removal) plus matching test and documentation updates — no unrelated application-code changes. |
| Repo-wide search for other consumers of `manifest.navigation` / `EfbNavigationMetadata` | PASS | No other call site depends on the removed field. |
| Cross-check of `native/navigation-report.json` artifact registration and `nativeArtifacts` inventory logic | PASS | Confirmed the report is still written to the artifact map and still enumerated under `nativeArtifacts` since that list is derived by filtering all artifact keys with a `native/` prefix. |
| `pnpm --dir apps/web lint`, `pnpm --dir apps/web test`, `pnpm --dir apps/web build`, `python tools/okf_relation_lint.py --manifest okf-base.yaml`, `python -m unittest ... test_okf_relation_lint.py` | NOT RUN (by me) | Per the task instructions I did not invoke Bash; Codex's implementation report states all of these passed. I did not find any diff content that would contradict that (both edited test files exercise exactly the new behavior and assert against it), but this is Codex's self-reported result, not independently re-executed in this review pass. |
| Live Project EFB controlled-development publish/import | NOT RUN (external system) | Reported by Codex in the implementation report and contract-status doc; not independently reproducible from this checkout since it requires the live receiver, credentials, and Supabase state. Internally consistent with the code fixes that were required to pass validation. |

## Residual risks

- The live-receiver validation/import claim (candidate `686d1fee-bf97-4ba4-9787-de87924bb81f`) rests on Codex's reported evidence and cannot be independently re-verified from this checkout alone; treat it as trusted-but-external until the still-pending explicit activation and real curator-document rollout check (both already flagged as open acceptance items in the base implementation report) are completed.
- General navigation-hub content-quality behavior (auto-generated boilerplate introduction text for empty hubs) is a reasonable fix for the receiver's content-length gate, but if Project EFB's receiver later tightens content-quality checks beyond length (e.g., requiring non-boilerplate prose), this generated sentence may need revisiting. Not a blocker today since the only known gate is the character-length minimum.

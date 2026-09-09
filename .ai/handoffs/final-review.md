# Independent implementation review: Unified OKF Release Pipeline (PoC)

## Verdict

`APPROVED`

## Acceptance-criteria assessment

| Criterion | Status | Evidence |
|---|---|---|
| One traceable resumable release-run model, single orchestration model | PASS | `apps/web/src/lib/knowledge/release-run.ts` implements the single `KnowledgeReleaseRun` stage machine (`gate_selection→classify→compile_navigation→build_package→upload→import→verify→activate`) with an additive migration. The previously-missing test coverage is now present in `apps/web/src/lib/knowledge/efb-workflow.integration.test.mts:211-317`, database-backed against a real approved `KnowledgeArticleRevision`/`KnowledgeEfbSelection`: (a) a full run through `createKnowledgeReleaseRun`→`runKnowledgeRelease` reaches `status: "completed"` with `completedStages` and per-stage handler invocations equal to all eight `KNOWLEDGE_RELEASE_STAGES` (lines 221-235); (b) a simulated crash inside the `classify` handler after `gate_selection` completes leaves the run `status: "failed"` with `completedStages === ["gate_selection"]` (lines 238-261), and a subsequent resume call with fresh handlers reaches `completed` while `resumeCalls.filter(s => s === "gate_selection").length === 1` (lines 262-280), proving the already-completed stage is not re-executed; (c) a concurrent second `runKnowledgeRelease` call on the same run id, issued while the first call is blocked inside `gate_selection`, is rejected with `/knowledge_release_run_not_claimable|knowledge_release_stage_race/` and `concurrentGateCalls === 1` (lines 282-316), proving the `status: "running"` claim guard (`release-run.ts:46-47`) prevents double execution. This satisfies the prior HIGH finding's required correction exactly (full completion, crash/resume without duplication, concurrent-claim rejection with single execution). |
| Article revisions are the sole new publishable input | PASS | Unchanged from prior pass: `createKnowledgeReleaseRun`/`assertApprovedSelection` reads only `KnowledgeEfbSelection`/`KnowledgeArticleRevision`; the new test additionally exercises this through a real `approve` editorial action before constructing selections (lines 202-209). |
| One classification persistence path for new automatic work | PASS | Unchanged: `classify` stage handler in `release-run.ts:79-89` checks `currentClassification` (`KnowledgeEfbClassification`) for `selectionMode === "automatic"` entries. |
| Navigation root, hubs, 100% reachability | PASS (fixture-level) | Unchanged from prior pass: `six-topic-release.integration.test.mts` asserts 6/6 reachability for the six-fixture corpus. Real ATA-27 79-article corpus run remains a disclosed, non-blocking gap for this PoC milestone. |
| Existing Project EFB receiver contract, no new schema | PASS | Unchanged: `efb-publisher/publish-package.ts` only issues actions through `PublisherApi`; no new table/schema code. `release-run.ts`'s `upload`/`import`/`verify`/`activate` handlers (lines 97-118) call `initializeAndUploadEfbPackage`/`importEfbPackage`/`verifyEfbRelease` and a plain `activate` action — all existing publisher functions, no new receiver surface. |
| Rollback is pointer-only | PASS | Unchanged: `rollbackEfbRelease` sends only `{ action: "activate", revision: retainedRevisionId }`. |
| Six controlled fixtures pass end to end | PASS (mocked receiver) | Unchanged: all six family/topic combinations pass classification, navigation compilation, signed `poc-cloud` packaging, and mocked activation. Disclosed as mocked, consistent with proposal's Stage 7 CI scope. |
| Live development activation / real curator rollout | NOT DONE (disclosed) | Unchanged: blocked on external Project EFB receiver credentials/enrollment and curator document selection, as the proposal's own "not confirmed / requires product or external decision" section anticipates. |
| Default repository checks pass | ACCEPTED ON REPORTED EVIDENCE | Per this review's instructions, no Bash/test commands were run in this pass. The implementation report records `pnpm --dir apps/web test` (861 Node tests passed, 3 skipped; 19 component tests passed, including the new database-backed release-run scenarios), `pnpm --dir apps/web lint` (pass), `pnpm --dir apps/web build` (pass), and both Python checks (pass) — Codex ran these directly. Static reading of the new test file confirms it exercises the code paths the report claims and that its assertions match real handler/DB behavior, not just success wrapping. |

## Findings

None. The single HIGH finding from the prior review pass — the resumable release-run orchestration being untested against real execution — is resolved by the `efb-workflow.integration.test.mts` additions described above, which specifically target the failure modes the model exists to handle (crash mid-run, concurrent workers) rather than only a happy-path run.

## Verification performed

| Command or check | Result | Notes |
|---|---|---|
| `pnpm --dir apps/web test` | NOT RUN (this pass) | Relying on implementation report's recorded result: PASS. Per instructions, this review used only Read/Glob/Grep/Write/Edit — Codex already ran this, lint, build, and the Python checks successfully. |
| `pnpm --dir apps/web lint` | NOT RUN (this pass) | Report: PASS. |
| `pnpm --dir apps/web build` | NOT RUN (this pass) | Report: PASS. |
| `python tools/okf_relation_lint.py --manifest okf-base.yaml` / unittest | NOT RUN (this pass) | Report: PASS. |
| Static review of `release-run.ts`, `efb-workflow.integration.test.mts` (new resumability/crash/concurrency assertions), `export.ts` and `efb-publisher/publish-package.ts` signatures referenced by `release-run.ts` | DONE | Confirmed the new test's crash-then-resume sequence correctly relies on `nextKnowledgeReleaseStage` skipping already-completed stages, and that the concurrent-claim test's rejection stems from the `status: "running"` guard in `runKnowledgeRelease`'s initial `updateMany` claim, not from an unrelated error. Confirmed `exportSelectedArticles`, `initializeAndUploadEfbPackage`, `importEfbPackage`, `verifyEfbRelease` are defined in the files `release-run.ts` imports them from. |

## Residual risks

- The six-fixture integration test mocks the Project EFB receiver; the first real-environment publish remains the actual point of truth for the publisher stages — already disclosed and out of scope for this milestone.
- No test covers the 79-article real ATA-27 corpus through the new navigation compiler; only the six-fixture corpus and prior manual-inspection evidence exist. Disclosed as a known, non-blocking limitation for this PoC milestone.
- The new concurrency test verifies only the initial claim guard (`status: "running"` on entry); it does not separately exercise the second `advanced` `updateMany` guard inside the stage-advance loop (`release-run.ts:60-61`, guarding a race between two claimants that both pass the initial claim, which cannot happen in the current single-claim design but exists as defense in depth). This is a minor coverage gap, not a functional defect — the code path is a redundant safety check under the current locking scheme.

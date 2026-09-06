# Local shared workflow verification — 2026-09-06

## Verified

- PostgreSQL dump restored into an isolated pgvector container. Original and derived storage, knowledge and release archives restored and byte-compared. Backup location: `C:/projects/av-okf-backups/20260905-refactor`.
- Additive migration applied to the restored database before local application. Repeated backfill preserved 230 shared revision snapshots and legacy document/topic/conversation identifiers and approval content.
- Production Next.js build completed in Docker. Web and worker use the new image. No EFB deployment or catalog activation occurred.
- Regression suite: 753 server/unit tests passed, two skipped; 14 React tests passed (767 passed total).
- Authenticated Playwright checks: articles, article detail, EFB selections, Topic builder and new chat at 1440, 820 and 390-pixel widths; no page overflow or page errors. A real greeting received the conversational response. The separate scope PATCH endpoint succeeded.
- Configured-provider fixtures: two-document cited chat, change-of-scope cancellation, source withdrawal during generation, graph candidate/native-link traversal and narrowed scope.
- Diagram generation accepted the strict output schema, rendered through the controlled renderer and remained unreviewed. The model and diagram policy were recorded. An evidence-reuse run completed with zero new research model steps/tool calls.
- Source PDF annotation, editable diagram replacement, preserved SVG masters and PNG derivatives, and immutable approved visuals passed fixture checks.
- Signed fixture export passed Project EFB's existing contract and signature validator: exactly one selected revision included; another approved revision excluded. No real publisher private key was created or configured by this test.
- Twenty fictional complementary-source research cases retrieved the designated critical passages. Five fictional article briefs were exercised with both graph research and full scans. These are development fixtures, not domain quality approval.

## Evidence and reproduction

Commands are in [recovery instructions](shared-knowledge-recovery.md). Runtime output is retained outside the repository in `C:/projects/AV-OKF-test-results.log`, `C:/projects/AV-OKF-build-results.log`, and `C:/projects/AV-OKF-live-checks.log`. Local browser screenshots/report are under ignored `work/topic-builder-verification/`.

The provider still reports an unsupported-temperature warning from an existing legacy chat stage; it ignored that setting and the tested answers completed. Model identity was not changed.

## Gates still open

- Real-document, human-reviewed evaluation set and the complete retained-library ingestion-to-export demonstration.
- Long-running ingestion restart/resume, transient provider failures, quota exhaustion and concurrent load at representative library sizes.
- Physical iPad/phone visual review; viewport emulation is not physical-device testing.
- Publisher signing identity for real selected-library exports. Fixture signatures do not register trusted publishers in EFB.
- Complete retirement of duplicate legacy write paths and standardization of all legacy queue results. Compatibility adapters remain active.
- End-to-end chat deadline unification: shared research is bounded, while legacy routing/final response stages retain their existing independent limits.

The local workflow is available for testing. These remaining gates prevent calling the full plan release-complete.

## Chat failure follow-up

Testing the retained hydraulics library exposed two gaps missed by the small fixtures: broad learning questions were routed to unnecessary clarification, and the 300/1,024-token query/answer budgets could yield no structured output. Answer generation then fell back to a source-snippet dump. The router now permits subject-led overviews; query/answer stages use 4,096/8,192 output budgets with low reasoning effort for the configured OpenAI reasoning model. Shared research no longer runs after a duplicate legacy retrieval pass, and synthesis receives inspected research passages instead of mixing in unrelated search candidates.

The exact user questions are reproduced by `apps/web/scripts/verify-real-chat.mts`. This check uses the retained local library and creates a clearly titled test conversation. It must produce model-authored cited answers, not router clarification or deterministic snippet fallback.

Final follow-up results: broad hydraulics question 19.76 seconds, two-document comparison 32.01 seconds; both produced model-authored cited answers. The comparison hit the research budget and displayed a partial-coverage notice. A browser PTU question produced an approved-OKF answer with three clickable citations and no page errors. The Docker build and 767 passing regression tests (two skipped) were rechecked. This verifies response behavior, not independent technical validation of every aviation claim; reconciliation of apparent source disagreements still requires scrutiny.

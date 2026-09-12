# Graph release readiness

Status: implementation in the working tree; not deployed. This document separates demonstrated behavior from remaining release work.

## Candidate artifact verification

Additional candidate checks: the selected page-88 source URL returned HTTP 200 with `application/pdf` and `private, no-store` for the authenticated browser; an unauthenticated request returned 401. All three `document-pdf-response` tests passed, including rejection of another workspace before reading bytes (unit coverage, not a second live tenant). The real entity map rendered its published layer (11 nodes/six connections) and source-evidence layer (1,711 nodes/4,672 connections) without browser errors. Initial published framing required Reset view; initial camera/resize behavior remains an open visual issue. Screenshots: `work/graph-candidate-entities.png`, `work/graph-candidate-entity-evidence.png`, `work/graph-candidate-entity-reset.png`.

Layer switching exposed a second working-tree fix: automatic detail now adapts to the current graph size, while explicit user choices persist. Browser fixture switched 48 nodes → 2,738 nodes → 48 nodes and observed All nodes → Groups → All nodes, with no errors; targeted lint passed. This and the relationship-filter fix are being packaged in candidate tag `20260906-r2`; build completion and artifact verification are still pending.

The completed image `av-okf-graph-candidate:20260906` (`cefdcca76b7d`) is running separately as `av-okf-graph-candidate` on localhost port 3002, using existing service configuration and read-only knowledge mounts. The existing web and worker services were not replaced. Login, the real published graph (228 concepts, six relationships), and the persisted incoming-link answer in session `cmtpb3tlo000001l7c92d1ooe` were exercised in the browser without reported errors. Selecting SOURCE OFF displayed its page-88 citation link. Screenshots: `work/graph-candidate-published.png`, `work/graph-candidate-answer.png`. Source endpoint authorization and the entity graph still require verification.

This exposed a grouped-view issue: internal relationships disappeared from the filter options when their communities were collapsed. The working-tree fix derives options from original assertions and switches to individual nodes when a relation is selected. Targeted ESLint passed; the 2,738-node development fixture verified Groups → All nodes with the selected relationship retained and no browser errors. This fix is newer than the candidate image and requires artifact verification after rebuilding.

## Verified

| Requirement | Evidence |
| --- | --- |
| Interactive 3D exploration with 2D fallback | Browser fixtures cover selection, filters, grouping, expansion, reset, and mobile controls. |
| Large-graph grouping outside the UI thread | 2,738-node browser fixture loaded its worker and rendered 15 groups; synthetic CPU benchmark is repeatable. |
| Scoped directed graph retrieval | Traversal tests cover incoming/outgoing paths, convergence, lifecycle exclusions, scope, and budgets. |
| Real published-file compatibility | 226 readable topics, 12 retained paths, database lifecycle snapshot, local withdrawal simulation. |
| Agent reads original evidence | Live research run `cmtpaxo3a000001ot9ym7o9i6` retrieved a published connection and inspected its source page. |
| Full shared-agent answer persistence | Session `cmtpb0815000001oa3vl6y3oh`, message `cmtpb0h1s000301oac7xhne8x`: two citations, one persisted directed relationship. |
| Missing relationship behavior | Session `cmtpb2m03000001nrm5t0jq9u`: fictional endpoint absent from provided evidence, no graph connection invented. This is one explicit negative probe, not a recall benchmark. |
| Incoming discovery through full answer persistence | Session `cmtpb3tlo000001l7c92d1ooe`: two inspected citations, original source-to-target relationship retained; 19.926 seconds. |
| Citation-to-graph mapping | Regression tests exercise final citation renumbering, removed endpoints, and overlapping page ranges. |
| Changed graph provenance rejected | Current publication, approved scoped endpoints, and source-page mapping are checked on reuse and before persistence. Unit tests cover changes; concurrent production mutation is not tested. |
| Latest integration build | Production build passed with test login disabled in the build process; 86 selected service/retrieval/graph tests passed. |

## Remaining gates

1. Evaluate multiple representative questions against a search-only baseline. Include incoming dependencies, multi-hop queries, ambiguity, conflicts, applicability, revised sources, and unanswerable questions. Assess correctness and source support independently of citation count.
2. Verify the final deployed UI with real published and entity graphs and the persisted live answer. Current screenshots use development fixtures. Verify source authorization, mobile interaction, WebGL fallback, and reduced motion on the release artifact.
3. Exercise target-resolution changes through the verifier/worker against controlled data. The 7-to-37 destination-resolution comparison does not prove that those destinations are correct published relationships.
4. Verify graph consistency under source edits, deletion, entity merge/split, and interrupted publication. Final read checks do not provide atomic protection across database and filesystem updates.
5. Finish integrity monitoring and release/rollback verification. Preserve database and file snapshots together. Verify the relevant feature flags in the release environment before enabling shared research.
6. Review the release contents: the checkout includes substantial shared-knowledge, topic-builder, and export changes beyond this graph work. A build of this checkout includes those changes too.

## Operational limits

The graph remains sparse: the inspected published bundle has six asserted relationships. Do not increase density by inventing links. PostgreSQL remains authoritative; current measurements do not establish a need for a separate graph database. No dedicated-store benchmark has been completed.

Research verifiers create audit records and verification chat sessions and use the configured provider. Snapshot verifiers do not mutate production data. Local files in `work/` contain source content and must not be treated as public fixtures.

# Implementation report: Full-network graph overview

## Outcome

The bundle Graph page opens recorded structural connections and live OKF
relations together, without automatic group collapse or permanent detail panes.
This projection does not change agent traversal or knowledge approval.

## Acceptance criteria

- [x] Whole network on entry: real bundle showed 989 nodes and 2,212 connections
  at final verification; these counts change with ongoing user processing.
- [x] Less duplicate clutter: accepted aliases become searchable metadata;
  repeated edges render once with every supporting record retained.
- [x] Evidence remains inspectable: source quotes, pages and status appear on
  selection. Structural links are explicitly not approved semantic relations.
- [x] No invented richness: only three edges were published semantic relations;
  the other 2,209 were structural source-evidence links.
- [x] New extraction gets explicit type guidance; existing records are unchanged.

## Changes

- `graph-network.ts`: identity-safe projection and scope/type filtering.
- Graph route and `graph-network-explorer.tsx`: full network default, optional
  filters/details, alias-aware search, browser selection history.
- 3D renderer and `graph-framing.ts`: uncollapsed connectivity-seeded placement,
  selection contrast, bounded isolates, viewport-aware fit around actual bounds.
- `entity-graph-view.ts`: trusted exported paths join entity and OKF concepts.
- `entity-graph.ts`: entity-grounding-v2 definitions discourage bare codes,
  heading fragments and generic instructions as entities.
- Architecture, roadmap, TODO, changelog and user journey updated.

## Deviations from proposal

No formal proposal preceded implementation. Existing identities were not
reclassified or merged merely to increase density. Generic `other` records
remain visible and filterable.

## Verification

| Check | Result | Notes |
|---|---|---|
| Full Node/component suite | PASS | 905 passed, five skipped before final camera refinements |
| Focused graph/entity tests | PASS | 20 tests |
| Focused network/framing tests | PASS | 10 tests, including portrait/landscape bounds and stale-edge exclusion |
| Full ESLint | PASS | Final camera refinement also production type-checked |
| Docker production build | PASS | Final Next.js compilation and TypeScript checks |
| Local production build | BLOCKED | Existing test-auth production configuration guard |
| Standalone TypeScript | FAIL | Existing test-fixture errors; configured application build passes |
| Python relation tests / lint | PASS | Five tests; base manifest has zero relation violations |
| Search, filters, evidence, history | PASS | Hydraulic entity, source pages, type counts and back/forward selection |
| 3D desktop/mobile | PASS | Screenshots at 2048x972 and 390x844; automatic fit without manual action |
| Tablet 2D | LIMITED | Renders at 768x1024 but remains overly clustered |
| Theme / console | PASS | Light/dark checked; no captured console errors; original theme and viewport restored |
| Canvas pixel assertions | NOT RUN | Nonblank rendering verified visually, not through automated pixel buffers |
| Provider quality benchmark | NOT RUN | New extraction prompt quality remains unmeasured |

## Baseline comparison

Previously, 141 concepts collapsed into three groups and the presence of any
published relation selected the sparse published-only view. The new overview
exposes existing evidence paths, not newly inferred semantic relationships.

## Known limitations and remaining risks

- Existing unclassified entities, homonyms and sparse semantic coverage need
  a separately evaluated repair process, not silent display-name merging.
- Retained 2D fallback is functional but bunched on this dense corpus.
- Rendering scales with node/edge counts; larger corpora need memory and
  performance benchmarks before increasing operational limits.
- No bulk reclassification, knowledge mutation or commit performed. Services
  remain running with the new web build.

## Manual review instructions

1. Open Graph from the sidebar. Full network is the default.
2. Search an entity and inspect neighbors, evidence and source pages.
3. Use Back/Forward to restore selection without forced camera zoom.
4. Filter types, restore all types and inspect Published relations separately.
5. Resize, rotate and zoom; Fit entire network restores the complete overview.

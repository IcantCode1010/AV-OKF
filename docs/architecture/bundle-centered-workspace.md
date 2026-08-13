# Bundle-Centered Workspace

## Purpose

AV-OKF uses a persistent active knowledge bundle as the primary navigation
context. This reduces movement between disconnected document, review, graph,
and chat screens without changing their trust or processing rules.

The workspace is organized by intent:

```text
Use:       Chat, Browse, Graph
Manage:    Documents, Review, Relations, Activity
Workspace: Knowledge bundles, Settings
```

The active bundle is stored in the HTTP-only, same-site
`av_okf_active_bundle` cookie. Every server request resolves the cookie against
the authenticated workspace's active bundle registry. An invalid or deleted
selection falls back to the first active bundle; an empty vault disables
bundle-scoped navigation.

## Selection Rules

- Switching bundles preserves the current workspace section when that section
  is meaningful for another bundle.
- Switching from Chat returns to `/chat`, which resumes the most recent
  conversation whose primary bundle matches the new active bundle.
- A chat's additional knowledge sources remain session-scoped. They never
  modify the browser's active bundle.
- Browse and Graph share the bundle-relative `?file=` selection. Browse uses a
  resizable tree and Markdown reader; Graph uses the existing read-only Cosmos
  graph and a concept drawer.
- Legacy bundle URLs redirect to the corresponding Browse, Relations, or
  Settings workspace without weakening path or workspace validation.

## Activity Projection

Bundle Activity is derived from existing extraction, discovery, authoring,
bulk-approval, relation-verification, and document-event records. It does not
create a parallel job state. The page polls an authenticated fingerprint only
while queued or running work exists and reloads when the projection changes.

Activity exposes stage, status, result counts, safe error summaries, and links
to the owning workflow. It never exposes prompts, provider raw responses,
document-contained instructions, or hidden model reasoning.

## Chat Lifecycle

`/chat` resumes the latest conversation for the active bundle. If none exists,
the new-chat composer is shown. A chat session is created only when the first
message is submitted, preventing unused empty sessions from entering history.

The existing deterministic router, selected multi-bundle scope, evidence
limits, validation, citations, lifecycle notices, and source drilldown remain
unchanged.

## Deferred Work

Annotations, correction requests, visual version diffs, rollback, evaluation
dashboards, and new agent authority are outside this presentation release.

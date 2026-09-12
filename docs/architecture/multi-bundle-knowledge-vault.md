# Multi-Bundle Knowledge Vault

## Contract

Every OKF v0.2 profile inherits required `type` plus the standard optional
`title`, `description`, `resource`, `tags`, `sources`, `generated`, `verified`,
`status`, and `stale_after` families. Profiles may add extension fields and
types but cannot remove `type` or redefine standard semantics.

Generic conformance and agent trust are separate. A file can be valid generic
OKF with only `type`. Approved agent evidence additionally requires active
lifecycle, current `status: stable`, recognized `verified` provenance, usable
title/body, portable `sources`, and source-page provenance.

## Storage

```text
knowledge/workspaces/{workspaceId}/
  okf-vault.json
  bundles/{bundleId}/
    okf-base.yaml
    index.md
    log.md
    concepts/{type}/
    procedures/{type}/
    references/sources/{source-reference}.md
    references/{type}/
    routing/{type}/
    indexes/{type}/
```

All production roots resolve through `resolveKnowledgeBundleRoot`. Workspace and server-generated bundle IDs are validated as storage segments. Relations, chats, documents, topic records, lifecycle rows, and coverage projections carry bundle ownership.

## Profiles

Generic and Aviation are immutable templates. UI edits clone the active profile into a draft. Activation validates all files, prevents an existing type from changing folders, writes the bundle manifest, and supersedes the prior profile version only after validation succeeds.

## Retrieval And Relations

Chat sessions select an ordered scope of one to ten active workspace bundles.
OKF and raw-RAG retrieval cannot leave the per-turn snapshot, and typed graph
traversal remains bundle-local. Relation discovery uses deterministic signals
followed by one-pair LLM verification; only confirmed candidates reach human
review, and only approval writes frontmatter.

## Migration And Deletion

`migrate:knowledge-vault` performs the earlier single-root to workspace-vault
migration. `migrate:okf-v0.2` then hashes source PDFs, creates portable source
references, maps trust/provenance, stages and validates all v0.1 bundles, and
requires explicit maintenance-window confirmation and a PostgreSQL backup.

Permanent bundle deletion uses one clear confirmation. It removes bundle-owned
knowledge, profiles, RAG, relations, and scoped chat evidence while preserving
uploaded PDFs, document metadata, extraction pages, jobs, and logs. Preserved
documents become Unassigned until a user assigns them to another active bundle.

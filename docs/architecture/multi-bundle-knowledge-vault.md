# Multi-Bundle Knowledge Vault

## Contract

Every OKF profile inherits five generic fields: required `type`, plus optional `title`, `description`, `tags`, and `updated`. Profiles may add fields and types but cannot redefine those semantics or remove `type`.

Generic conformance and agent trust are separate. A file can be valid generic OKF with only `type`. Approved agent evidence additionally requires an active lifecycle, `review_status: approved`, usable title/body, and source-file/page provenance.

## Storage

```text
knowledge/workspaces/{workspaceId}/
  okf-vault.json
  bundles/{bundleId}/
    okf-base.yaml
    index.md
    log.md
    source_manifest.md
    concepts/{type}/
    procedures/{type}/
    references/{type}/
    routing/{type}/
    indexes/{type}/
```

All production roots resolve through `resolveKnowledgeBundleRoot`. Workspace and server-generated bundle IDs are validated as storage segments. Relations, chats, documents, topic records, lifecycle rows, and coverage projections carry bundle ownership.

## Profiles

Generic and Aviation are immutable templates. UI edits clone the active profile into a draft. Activation validates all files, prevents an existing type from changing folders, writes the bundle manifest, and supersedes the prior profile version only after validation succeeds.

## Retrieval And Relations

Chat sessions select one bundle and cannot search another. OKF retrieval reads that bundle live; raw RAG queries filter through the document's bundle. Relation discovery uses deterministic signals to create pending candidates. Pending and rejected candidates never affect traversal. Approval validates the bundle-relative target and active vocabulary, updates the topic working copy, and re-exports frontmatter.

## Migration And Deletion

`migrate:knowledge-vault` requires an explicit workspace ID. Its default is a dry run; `--apply` creates a backup and recovery journal, moves concepts into type folders, replaces `last_verified` with `updated`, and rewrites path projections and chat citations.

Permanent deletion requires the exact bundle name. The web process marks the bundle `deleting` and enqueues an idempotent BullMQ job. The worker deletes source objects, the physical bundle, and the bundle row whose cascades remove documents, extraction, topics, RAG, lifecycle, coverage, profiles, and chats. A minimal workspace audit record remains.

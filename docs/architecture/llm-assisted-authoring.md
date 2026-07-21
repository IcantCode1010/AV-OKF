# LLM-Assisted Knowledge Authoring

## Purpose

The guided authoring workflow coordinates the document-to-knowledge steps that previously required separate actions:

```text
extraction
  -> metadata discovery
  -> concept discovery
  -> enrichment
  -> relation classification
  -> validation
  -> human review, approval, and export
```

The LLM prepares a review package. It is not a knowledge publisher and has no deletion or lifecycle authority.

## Durable Run

`KnowledgeAuthoringRun` is the parent workflow record. It stores the current stage, completed stages, cost estimate, errors, validation results, review readiness, and an immutable snapshot of the bundle profile version and automatic-publication setting. `KnowledgeAuthoringStageAudit` is append-only stage history. Provider calls remain audited by the existing topic discovery and enrichment audit tables, while metadata proposals have their own reversible record.

Publication is human-controlled by default. A bundle admin may activate `automation.autoApproveEnrichedTopics` through a versioned profile draft. Enabled runs automatically publish only high-confidence, fully enriched, metadata-valid, non-overlapping topics with established source pages. All other topics remain in review with explicit blocker reasons. Automatic publication records provenance and never approves relation suggestions or performs archive, retraction, or deletion actions.

Each stage audit carries an explicit attempt number. The worker persists `currentStage` before stage execution and reports failures against that in-memory active stage rather than re-reading potentially stale run state. The product UI shows one latest row per stage and keeps every underlying attempt in an expandable history.

Extraction queues one authoring run. The worker performs the stages sequentially and can resume from completed stages after a failure. Existing manual topic discovery remains available as a recovery tool.

## Stage Rules

- **Metadata discovery:** proposes general-purpose document metadata from extracted text. Valid normalized values are applied immediately, with previous values retained for explicit undo.
- **Concept discovery:** reuses bounded, overlapping page-window analysis and document-wide consolidation. Approved and rejected topics remain preserved.
- **Enrichment:** automatically enriches medium/high-confidence drafts. Low-confidence drafts remain raw and require cleanup.
- **Relation classification:** starts only from deterministic candidate pairs, then asks the configured provider to choose from the active bundle profile's relation vocabulary. Suggestions remain `pending` and cannot affect graph traversal.
- **Validation:** checks title, summary, source coverage, enrichment failures, and unresolved source-page proposals. The run then stops at `ready_for_review`.

## Cost Boundary

The workflow pauses before enrichment when estimated input exceeds 250,000 tokens or more than 25 topics would be enriched. A workspace user must explicitly confirm before the durable run continues.

## Human Authority Boundary

The authoring operation registry deliberately contains no operation for approval, export, archive, retract, or delete. Reviewers use the existing topic controls to edit content, resolve proposed pages, choose raw or enriched content, approve relations, and export valid topics. Valid topics may be published individually; invalid topics remain unapproved rather than blocking unrelated valid work.

Deletion always remains a direct end-user lifecycle action outside this workflow.

After reviewers approve and export both topics in a suggested pair, they may explicitly promote the suggestion into the bundle's existing relation-candidate queue. Promotion converts topic IDs into stable exported paths. A second reviewer action validates and re-exports the relation before it can appear in OKF frontmatter, the graph, backlinks, or agent traversal.

## Real Provider Verification

The `test:e2e:llm` profile resolves the encrypted provider key configured for the document's workspace in Settings. It accepts no command-line API key and has no deterministic provider fallback. Unit tests continue to inject deterministic providers for isolated logic; the production E2E profile verifies the real provider, database, audit, and document pipeline. See [Real LLM Authoring End-to-End Profile](../testing/real-llm-authoring-e2e.md).

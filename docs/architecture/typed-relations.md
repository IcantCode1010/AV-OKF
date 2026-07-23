# Typed Relations

## Purpose

OKF Markdown links create a graph, but a plain link does not explain what kind of relationship exists.

AV-OKF should use typed relations for agent reasoning and validation. Legacy fields such as `related_faults` and `related_topics` may remain as simple convenience lists, but they are not enough for operational routing or evidence decisions.

## Relation Field

Knowledge files may include a `relations` frontmatter field.

Example:

```yaml
relations:
  - relation: routes_to
    target: ../manuals/mel/elt.md
    target_type: dispatch_reference
    reason: Dispatch questions for this ELT fault require MEL evidence.
  - relation: references
    target: ../ata/ata-23-communications/elt-system.md
    target_type: system_topic
    reason: Provides system background, not dispatch authority.
```

## Controlled Vocabulary

The relation vocabulary lives in `okf-base.yaml` under `relations.allowed`. The initial allowed values are:

| Relation | Meaning | Validator Impact |
| --- | --- | --- |
| `routes_to` | Source object directs the agent to the target for a specific workflow or manual path. | Strong routing signal. Can help satisfy manual-path claims when the source is approved. |
| `references` | Source object mentions or points to supporting context. | Weak context signal. Does not establish authority by itself. |
| `supports` | Target provides evidence for the source object's statement or rule. | Evidence candidate. Still requires citation, authority, and review-status checks. |
| `covered_by` | Source object is governed by a reviewed OKF concept or source manifest entry. | Validator should prefer the governing approved object over raw RAG evidence. |
| `supersedes` | Source object replaces the target. | Target should be treated as stale unless explicitly requested for history. |
| `conflicts_with` | Source object contradicts the target. | Validator should flag conflict and prefer approved, current, authoritative source. |
| `depends_on` | Source object requires the target before it can be safely used. | Missing target should produce missing-context or missing-evidence handling. |

Do not use a generic relation when the intent is operational. A fault route that sends the user to the MEL should use `routes_to`; a training topic that merely provides background should use `references`.

## Lint Boundary

For MVP, `okflint` enforces that `relations` is an allowed frontmatter field and blocks unknown top-level fields.

The relation vocabulary is enforced by `tools/okf_relation_lint.py`. That rule rejects relation entries unless:

```text
relation is in the controlled vocabulary
target is present
target follows the AV-OKF link-resolution rules
target resolves inside the OKF bundle or allowed external source manifest
target_type is present when the target is an OKF object
target_type matches the resolved target file's frontmatter type
```

Relation targets are internal bundle links for MVP. See [Link Resolution](link-resolution.md) for the exact Markdown and path rules.

## Reviewed Discovery

Relation discovery is a review aid, not a graph-writing agent. There are two staged inputs:

1. Bundle discovery compares approved exported concepts with deterministic signals.
2. Assisted authoring may send up to 50 deterministically filtered draft-topic pairs through the same verifier one pair at a time, but stores confirmed results only in `KnowledgeAuthoringRun.relationSuggestions`.

Neither path writes OKF frontmatter. Authoring suggestions require a user to promote them to pending review, and every pending candidate requires a second explicit approval before the source topic is updated and re-exported. Automatic topic approval does not promote or approve relations.

Candidate quality is profile-scoped. Basic English function words remain code-owned; Generic and Aviation discovery stopwords live in the versioned bundle profile. A title/description signal requires at least two meaningful shared terms. The UI records the actual sorted shared terms and tags, not only category names. Concepts are sorted by bundle-relative path before pairing, so rerunning discovery produces stable proposed direction and ordering.

One shared graph preflight runs during bundle discovery, authoring-suggestion promotion, and final approval. It rejects:

- exact and symmetric `conflicts_with` reverse duplicates;
- unsafe, missing, inactive, cross-bundle, or type-mismatched targets;
- cycles in `depends_on`, `routes_to`, and `supersedes`;
- competing active `supersedes` edges targeting one concept.

Reverse `references` and `supports` edges remain possible when independently justified, but carry a warning.

V3 inserts an evidence-verification boundary before human review. Each deterministic candidate is queued independently. A structured provider response must select only the active profile vocabulary and include an exact quote from the selected relation source. The application canonicalizes extraction whitespace but does not case-fold, remove punctuation, or fuzzy-match evidence. Prompt-like text inside a concept remains untrusted data, and the verifier has no tools or graph-writing authority. Content hashes bind the result to both concept versions.

Only `confirmed` candidates enter the reviewer list or pending-edge graph preflight. `queued`, `running`, `filtered`, and `failed` candidates never enter frontmatter, the explorer graph, or agent traversal. A direction change clears confirmation and queues another one-pair verification because the evidence must come from the newly selected source. Final approval rechecks content hashes, vocabulary, quote, target/path safety, and graph integrity before exporting the rationale and exact quote in the portable `reason` field.

The rollout removes old `pending` candidates only. Human-approved and human-rejected history and every OKF Markdown file remain unchanged. The first configured-provider checkpoint requires at least 80% precision on a representative human-reviewed sample; approximately 90% is required before considering reduced review, semantic expansion, or stronger operational-relation trust.

Run `pnpm --dir apps/web eval:relations` with `RELATION_EVAL_WORKSPACE_ID` and optional comma-separated `RELATION_EVAL_BUNDLE_IDS` to write a dry-run before/after report. The report includes candidate counts, terms, tags, direction, warnings, and suppression reasons and leaves explicit human-review fields incomplete. Semantic neighbor generation, weighted scoring, broader LLM classification, and bulk relation approval remain blocked until a representative sample is reviewed.

## Agent Rules

The Retrieval Agent may use `references` as a recall signal, but it should give stronger weight to `routes_to`, `supports`, and `covered_by`.

The Validation Agent should treat relation types as evidence context, not proof by themselves. A `routes_to` relation can support a manual-path claim, but it cannot support a dispatch conclusion unless the target source authority and review status also pass.

When a relation says `supersedes` or `conflicts_with`, the validator should include both objects in the evidence set and apply the authority, revision, and review-status rules before allowing the claim.

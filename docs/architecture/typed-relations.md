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

Use this initial relation vocabulary:

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

The relation vocabulary should be enforced by a deterministic follow-on lint rule if `okflint` cannot validate nested list objects in the current release. That rule should reject relation entries unless:

```text
relation is in the controlled vocabulary
target is present
target follows the AV-OKF link-resolution rules
target resolves inside the OKF bundle or allowed external source manifest
target_type is present when the target is an OKF object
```

Relation targets are internal bundle links for MVP. See [Link Resolution](link-resolution.md) for the exact Markdown and path rules.

## Agent Rules

The Retrieval Agent may use `references` as a recall signal, but it should give stronger weight to `routes_to`, `supports`, and `covered_by`.

The Validation Agent should treat relation types as evidence context, not proof by themselves. A `routes_to` relation can support a manual-path claim, but it cannot support a dispatch conclusion unless the target source authority and review status also pass.

When a relation says `supersedes` or `conflicts_with`, the validator should include both objects in the evidence set and apply the authority, revision, and review-status rules before allowing the claim.

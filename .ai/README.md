# Claude-Codex handoff workflow

This repository uses a three-stage workflow for substantial changes:

1. Claude Code investigates and writes a proposal.
2. Codex Astra implements the approved proposal.
3. Claude Code independently reviews the implementation.

Reusable instructions live in `.claude/skills/` and `.agents/skills/`.
Handoff documents are created in `.ai/handoffs/` from `.ai/templates/`.

## Operating rules

- Begin from a clean, named feature branch.
- Only one agent edits application code at a time.
- Claude does not edit application code during proposal or initial review.
- Codex verifies proposal claims rather than treating them as infallible.
- Existing baseline failures must not be reported as new regressions.
- A change is complete only after acceptance criteria and verification pass.
- Commit handoff documents with the feature branch when they contain useful
  architectural history. Remove purely temporary handoffs before merging.

## Typical session

Once when adopting the workflow, and again after intentional baseline changes:

```text
/baseline-codebase
```

In Claude Code:

```text
/propose-change <objective>
```

After the proposal is approved, in Codex:

```text
Use $implement-proposal to implement .ai/handoffs/change-proposal.md
```

After implementation, return to Claude Code:

```text
/review-implementation
```

If Claude identifies supported blockers or high/medium findings, give the
review back to Codex for correction, then run `/review-implementation` again.

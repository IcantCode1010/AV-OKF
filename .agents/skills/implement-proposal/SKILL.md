---
name: implement-proposal
description: Implement an approved Claude change proposal in AV-OKF, verify it, and prepare the structured implementation handoff for independent review.
---

# Implement an approved proposal

Read `AGENTS.md`, `CLAUDE.md`, `.ai/handoffs/change-proposal.md`, and the
relevant code before editing.

## Gate

Do not implement when the proposal is absent, has unresolved material decisions,
conflicts with the current code, or cannot be completed safely within its stated
scope. Document the discrepancy and request direction.

## Implementation

- Verify the proposal's claims against the current checkout.
- Implement the approved acceptance criteria in the smallest coherent change.
- Preserve unrelated changes and behavior outside scope.
- Follow the repository invariants in `AGENTS.md` and architectural guidance in
  `CLAUDE.md`.
- Add or update meaningful tests. Do not weaken validation to obtain a pass.
- Re-check both backend paths and workspace scoping where applicable.

## Verification and handoff

Run the relevant tests, lint, build, deterministic OKF lint, and any focused
manual checks required by the proposal. Inspect the final diff.

Use `.ai/templates/implementation-report.template.md` to create or replace
`.ai/handoffs/implementation-report.md`. Record exact commands and results,
including failures and checks not run. Explain every deviation from the
proposal. Do not claim completion when required acceptance criteria remain
unverified.

Stop after the implementation report so Claude can independently review the
change. Do not commit, push, merge, or deploy unless the user explicitly asks.


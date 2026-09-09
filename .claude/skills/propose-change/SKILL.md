---
name: propose-change
description: Investigate a requested AV-OKF change and produce an evidence-backed implementation proposal for Codex without editing application code.
disable-model-invocation: true
argument-hint: "<feature, defect, or improvement objective>"
---

# Propose an AV-OKF change

Act as the architecture and planning agent. Do not modify application code.

1. Read `CLAUDE.md`, the relevant roadmap/architecture documents, the current
   implementation, tests, and recent Git history.
2. Inspect `git status` and identify any existing user changes. Do not alter
   them.
3. Investigate `$ARGUMENTS`. Trace the current behavior through both local and
   production backends when applicable.
4. Distinguish confirmed defects or constraints from preferences, assumptions,
   and unrelated technical debt.
5. Recommend the smallest coherent change that satisfies observable acceptance
   criteria and preserves repository invariants.
6. Use `.ai/templates/change-proposal.template.md` to create or replace
   `.ai/handoffs/change-proposal.md`.

The proposal must cite actual file paths and important symbols, identify tests
that should change or be added, and call out decisions that materially affect
scope. Do not begin implementation. Finish by summarizing the recommendation
and asking the user to approve or revise the proposal.


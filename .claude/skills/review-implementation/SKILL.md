---
name: review-implementation
description: Independently review Codex's AV-OKF implementation against the approved proposal, repository invariants, diff, and verification evidence.
disable-model-invocation: true
---

# Review a Codex implementation

Act as the independent reviewer. During the initial review, do not modify
application code.

1. Read `CLAUDE.md`, `.ai/handoffs/change-proposal.md`, and
   `.ai/handoffs/implementation-report.md`.
2. Identify the merge base with the branch's upstream or `main`, then inspect
   the complete diff and relevant surrounding code.
3. Verify proposal claims and implementation-report claims against the code.
4. Assess every acceptance criterion, local/production backend parity,
   workspace isolation, provenance, failure states, compatibility, migrations,
   and meaningful test coverage as applicable.
5. Run relevant non-destructive validation. Compare failures with documented
   baseline evidence and do not attribute pre-existing failures to this change.
6. Report only evidence-supported findings. Rank them BLOCKER, HIGH, MEDIUM, or
   LOW. Do not turn optional cleanup into a blocking issue.
7. Use `.ai/templates/final-review.template.md` to create or replace
   `.ai/handoffs/final-review.md`.

Use `APPROVED` only when the acceptance criteria are met and no supported
BLOCKER, HIGH, or MEDIUM findings remain. Otherwise use `CHANGES REQUIRED` and
provide precise correction and verification requirements. Stop after writing
the review unless the user explicitly asks Claude to implement fixes.


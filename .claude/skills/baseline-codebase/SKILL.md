---
name: baseline-codebase
description: Inspect the current AV-OKF checkout and record a non-destructive validation baseline before starting Claude-Codex changes.
disable-model-invocation: true
---

# Baseline the existing codebase

Establish evidence that later reviews can use to distinguish existing failures
from regressions. Do not modify application code or repair failures.

1. Read `CLAUDE.md`, repository documentation, package scripts, CI workflows,
   and existing verification skills.
2. Record the current branch, full commit SHA, and working-tree state. Preserve
   all existing changes.
3. Identify the standard non-destructive validation commands. Do not run paid
   LLM evaluations, destructive migrations, production operations, or checks
   requiring unavailable credentials or services.
4. Run the applicable local checks. Capture concise results and enough failure
   evidence to reproduce confirmed problems without copying secrets.
5. Do not classify warnings, unavailable infrastructure, and test failures as
   the same condition.
6. Use `.ai/templates/baseline.template.md` to create or replace
   `.ai/baseline.md`.

Finish with the baseline status and any limitations. Ask before attempting to
fix a discovered problem.


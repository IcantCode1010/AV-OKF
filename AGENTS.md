# AGENTS.md

This file defines how Codex works in AV-OKF. Read `CLAUDE.md` first; it is the
shared source of truth for the product architecture, repository layout,
backend split, and validation commands.

## Role in the review workflow

Codex is the implementation agent. Claude Code acts as the proposing and
reviewing agent.

For work using the structured handoff workflow:

1. Read `.ai/handoffs/change-proposal.md` and verify its claims against the
   current checkout.
2. Implement only the approved scope and acceptance criteria.
3. Preserve unrelated working-tree changes and existing behavior outside the
   proposal.
4. Run the relevant repository checks described in `CLAUDE.md`.
5. Record the implementation and verification evidence in
   `.ai/handoffs/implementation-report.md` using the repository template.
6. Stop for Claude review. Do not silently expand the change into adjacent
   cleanup or refactoring.

If the proposal is missing, internally inconsistent, unsafe, or contradicted
by the code, stop and document the discrepancy instead of guessing.

## Repository invariants

- Keep the core platform domain-generic; aviation is a domain pack.
- Preserve the separation between raw RAG chunks and human-reviewed OKF
  topics.
- Consider both local-vault and production implementations when changing a
  document or topic operation.
- Enforce workspace isolation in the repository/data-access layer.
- Preserve page-level provenance and evidence-bound citation behavior.
- Never weaken deterministic validation to make an LLM-generated result pass.
- Never run destructive migrations or modify production data as part of local
  verification.

## Default validation

Use the smallest relevant set while developing, then run the full applicable
set before handoff:

```bash
pnpm --dir apps/web lint
pnpm --dir apps/web test
pnpm --dir apps/web build
python3 -m unittest tests/test_okf_relation_lint.py
python3 tools/okf_relation_lint.py --manifest okf-base.yaml
```

Tests that require credentials, infrastructure, or paid model calls are not
part of the default suite. Run them only when the proposal requires them and
the environment is intentionally configured.


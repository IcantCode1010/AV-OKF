# okflint Profile

## Purpose

AV-OKF uses `okflint` as the deterministic frontmatter enforcement gate for approved OKF bundles.

This replaces a custom "required fields by file type" validator for MVP-02. The project still needs runtime evidence validation for generated answers, but OKF file conformance should be handled by `okflint`.

## Files

```text
okf-base.yaml
knowledge/
  index.md
  log.md
.github/workflows/okflint.yml
```

## What okflint Enforces

`okflint` enforces:

```text
OKF core conformance
required frontmatter fields by type
allowed review_status values
date field formatting
broken Markdown links
reserved index/log files
unknown frontmatter fields
allowed typed-relation frontmatter field
```

The AV-OKF profile is defined in:

```text
okf-base.yaml
```

Example:

```yaml
dispatch_reference:
  required:
    - type
    - review_status
    - title
    - description
    - aircraft_family
    - manual_type
    - ata
    - effectivity
    - source_authority
    - revision
    - source_file
    - source_pages
    - knowledge_version
    - last_verified
```

Typed relation fields are allowed in the profile:

```yaml
relations:
  - relation: routes_to
    target: ../manuals/mel/example.md
    target_type: dispatch_reference
    reason: Dispatch claims require MEL evidence.
```

If the current `okflint` release cannot enforce nested relation vocabulary, add a deterministic follow-on lint check for relation entries. Do not rely on the LLM validator to catch malformed relation names.

## CI Gate

The GitHub Actions workflow runs:

```bash
okflint validate --manifest okf-base.yaml
```

If profile or OKF conformance errors are present, the command exits non-zero and fails CI.

## Boundary With Runtime Validation

`okflint` validates that approved OKF files have the required metadata shape.

It does not validate whether a generated answer is safe. Runtime answer validation still belongs to the Validation Agent:

```text
okflint = deterministic OKF file conformance
Validation Agent = generated-answer claim support and source authority
```

Typed relations sit between those layers:

```text
okflint = relations field is allowed and unknown fields are blocked
relation lint = relation names and target shape are deterministic
Validation Agent = relation meaning affects evidence interpretation
```

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

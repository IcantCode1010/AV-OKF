# 737NG OKF Article Format Repair Review

Date: 2026-07-21

## Status

- Mode: dry run only
- Bundle: `737ng`
- Workspace: `cmr2lf3s0000101suuz8cz5mn`
- Bundle ID: `cmruul0l7000401mi6tfdja89`
- Topics inspected: 31
- Topics requiring canonical re-export: 31
- Approved content changed: no
- Report hash: `e41286e92f612d7ad377d9cb0f001c6ef878c8c482057c4c84d0a17ea81ebed7`
- Full per-topic report: `docs/debug/okf-article-format-repair-737ng-dry-run-2026-07-21.json`

The apply operation was deliberately not run. The matching report hash must be acknowledged only after human review.

The database also contains one approved topic, `Checklist Instructions Overview`, with no exported file path. It is outside this exported-content repair and was not included in the 31-file report.

## Repair Rules

The proposed repair is mechanical:

1. Remove a leading level-one heading only when it exactly matches the topic title after Unicode NFKC normalization, lowercasing, punctuation-to-space conversion, trimming, and whitespace collapsing.
2. Remove only a trailing `## Source` framing section from stored article content. The exporter remains the sole writer of the canonical source section.
3. Suppress a repeated description in readers only when the complete first prose paragraph exactly equals the complete frontmatter description after the same normalization.
4. Do not use fuzzy matching, semantic similarity, stemming, or an LLM.
5. Preserve approval, title, summary, source pages, relations, filename identity, and all substantive article sections.

## Human Review Sample

The following eight topics were reviewed from the dry-run output. Each proposed change removes one redundant leading H1. None removes a trailing source section, and each exported file currently has two matching leading title headings.

| Topic | Before | After | Review |
| --- | --- | --- | --- |
| APU Fire Response Procedure | `# APU Fire Response Procedure` then `## Condition` | Starts at `## Condition` | Only duplicate title framing removed. Procedure steps unchanged. |
| Brake Cooling Schedule | `# Brake Cooling Schedule` then explanatory paragraph | Starts at the explanatory paragraph | Table and cooling schedule content preserved. |
| Warning Lights and Indicators | `# Warning Lights and Indicators` then explanatory paragraph | Starts at the explanatory paragraph | Quick Action Index table preserved. |
| Airplane Model Identification | `# Airplane Model Identification` then `## General` | Starts at `## General` | Identification text and configuration data preserved. |
| Emergency Procedures | `# Emergency Procedures` then overview paragraph | Starts at the overview paragraph | Emergency sections and procedures preserved. |
| CDS Fault Management | `# CDS Fault Management` then `## Condition` | Starts at `## Condition` | Nested `# Display Failure` section remains because it is substantive content and does not match the topic title. |
| Evacuation Procedure | `# Evacuation Procedure` then condition heading | Starts at the condition heading | All evacuation steps preserved. |
| No Engine Bleed Configuration | `# No Engine Bleed Configuration` then `## Overview` | Starts at `## Overview` | Configuration details and procedural steps preserved. |

## Preservation Checks

For every candidate, the report records these fields as preserved:

- approval state;
- title and summary;
- source page attribution;
- typed relations;
- stable topic identity and collision-safe filename.

Each re-export would run through the existing approved-topic exporter rather than editing files under `knowledge/` directly. That path regenerates canonical frontmatter, exactly one top-level title, exactly one source section, bundle index entries, manifest entries, logs, and semantic embedding jobs.

## Approval Gate

Applying the repair requires a newly generated dry run whose hash exactly matches the acknowledged hash. If any topic, body, or exported file changes between review and apply, the hash changes and the apply command is rejected.

This review does not authorize applying the repair. A reviewer must explicitly approve the current report hash first.

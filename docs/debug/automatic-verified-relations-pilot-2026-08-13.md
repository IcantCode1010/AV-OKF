# Automatic Verified Relations Pilot - 2026-08-13

## Purpose

Exercise bundle-scoped automatic topic approval and automatic verified
relations against the real Docker stack and configured workspace provider,
without modifying the aviation bundle.

## Corpus

- Bundle: `Equipment Relations Pilot` (Generic profile v2)
- Document: `Doosan Generator Operations and Maintenance Manual`
- Input: 1.8 MB, 104-page equipment operations PDF
- Provider/model: configured OpenAI provider, `gpt-4o-mini`
- Automation: high-confidence topic approval on; 90%+ verified relation
  publication on

## Processing Results

| Result | Count |
| --- | ---: |
| Topics discovered | 31 |
| High-confidence topics enriched | 26 |
| Topics automatically approved/exported | 17 |
| Topics retained for review | 14 |
| Automatic export failures | 0 |

The retained set contains nine enriched high-confidence topics blocked by
deterministic automatic-approval gates and five medium-confidence topics that
are intentionally ineligible for automation.

## Relation Results

| Result | Count |
| --- | ---: |
| Deterministic candidates sent to the verifier | 50 |
| Verifier negatives | 49 |
| Exact-quote validation failures | 1 |
| Confirmed candidates | 0 |
| Automatically published edges | 0 |

The one validation failure was between `Operating and Towing Instructions`
and `Starting and Stopping Procedures`; the model-supplied quote did not match
the canonical source exactly and was rejected. The other pairs were rejected
because their source concept did not explicitly support the proposed relation.

## Defect Found And Fixed

Extraction-created authoring runs used a repository path that snapshotted
`autoApproveEnrichedTopics` but omitted `autoApproveVerifiedRelations`. The
pilot exposed the mismatch before relation classification. The repository now
derives and stores both settings through one helper, with regression tests for
enabled and malformed/missing values.

## Decision

`hold_for_tuning`

The fail-closed policy worked: no unsupported graph edge was written, and the
invalid quote was blocked. Because no positive edge was confirmed, this run
cannot establish the 80% precision checkpoint or measure recall. Do not weaken
the exact-quote or 90% publication gates. The next evaluation should use two
or more related documents containing known explicit cross-references so the
pipeline has positive and negative controls.

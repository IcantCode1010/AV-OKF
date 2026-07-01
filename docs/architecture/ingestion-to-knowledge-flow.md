# Ingestion To Knowledge Flow

## Purpose

This document defines how uploaded documents become searchable RAG content and, separately, approved OKF knowledge.

The key rule is:

```text
RAG indexes everything immediately.
OKF is built slower from document structure and requires human approval.
Approved OKF links back to the RAG chunks it covers.
```

## Core Flow

```text
Document upload
-> Page extraction
-> Immediate RAG indexing, no approval gate
-> Structural topic detection from document structure
-> Draft topic records
-> Human review
-> Approved OKF concepts
-> OKF concepts linked to covered RAG chunks
-> Validator uses OKF as authority when OKF and RAG disagree
```

## RAG Path: Immediate And Ungated

RAG is the broad discovery layer. It should ingest all readable document content as soon as extraction completes.

RAG includes:

```text
raw page text
tables
image analysis when available
OCR text
page metadata
document metadata
unreviewed topic records, labeled as unreviewed
```

RAG does not require human approval before indexing.

Rationale:

```text
RAG answers open-ended discovery questions.
RAG needs broad coverage.
RAG is allowed to search messy, unreviewed, and incomplete material.
RAG evidence must stay labeled by source and review status.
```

Constraint:

```text
RAG evidence can support discovery, summaries, and "find mentions" answers.
RAG evidence cannot override approved OKF for canonical claims.
RAG evidence cannot become official knowledge without review.
```

## OKF Path: Structured, Slower, Reviewed

OKF is the curated knowledge layer. It should not be built from arbitrary RAG chunks.

OKF generation should use document structure:

```text
document title
table of contents
headings
section hierarchy
page ranges
procedure boundaries
tables
warnings/cautions/notes
source manifest metadata
domain-specific structure
```

Draft OKF concepts come from whole topics, not isolated chunks.

Examples:

```text
good OKF source unit: "Refund Policy" section, pages 4-6
bad OKF source unit: three semantically similar chunks from pages 4, 19, and 48

good aviation OKF source unit: "GEN OFF BUS" fault route or AMM task section
bad aviation OKF source unit: unrelated vector chunks mentioning generator and bus
```

OKF requires human approval before becoming trusted.

Review statuses:

```text
raw_extracted
needs_ai_cleanup
needs_human_review
approved
rejected
deprecated
```

Only `approved` concepts are trusted OKF.

## Coverage Links

Every approved OKF concept should link back to the RAG chunks, pages, and source records it covers.

The purpose is not to make OKF depend on RAG. The purpose is to let the system know when a RAG result is already governed by an approved OKF concept.

Coverage link fields:

```text
okf_concept_id
source_document_id
source_page_start
source_page_end
covered_rag_chunk_ids
covered_topic_record_ids
coverage_type
review_status
approved_by
approved_at
```

Coverage types:

```text
direct_source
summary_of_source
policy_authority
procedure_reference
domain_rule
manual_route
```

## Conflict Handling

When approved OKF and RAG disagree, the validator should trust approved OKF for canonical claims.

Conflict examples:

```text
RAG chunk says refund window is 30 days.
Approved OKF says refund window is 14 days.
Validator trusts OKF and flags RAG conflict.

RAG chunk contains old manual procedure.
Approved OKF source manifest marks a newer revision as authoritative.
Validator trusts approved OKF/source manifest and flags stale RAG evidence.
```

Conflict rule:

```text
Approved OKF > reviewed topic record > raw RAG chunk
```

RAG can still be shown as discovery evidence, but it cannot override the approved concept.

## Router Impact

The router should not treat OKF and RAG as equal for every query.

```text
Canonical/direct question -> OKF
Open-ended/discovery question -> RAG
Question needing official concept plus raw examples -> Hybrid
```

Hybrid should use OKF first, then use RAG only for the evidence gap.

## Validator Impact

The validator should use OKF coverage links during evidence checks.

If a claim is supported by RAG evidence that is covered by an approved OKF concept:

```text
validate against the approved OKF concept first
then use RAG as supporting source context
```

If RAG evidence conflicts with the approved OKF concept:

```text
block or rewrite the conflicting claim
record unsupported_conflict
cite the approved OKF concept as controlling evidence
```

If no approved OKF concept covers the RAG evidence:

```text
allow RAG for discovery
label answer as based on retrieved documents
avoid official/canonical wording
```

## MVP Implementation Notes

Implement this in phases:

1. Index all extracted pages into RAG immediately after extraction.
2. Generate topic records separately from heading/page structure.
3. Add human review status to topic records.
4. Export only approved topic records into OKF.
5. Create coverage links from OKF concepts to source pages and RAG chunks.
6. Teach the validator to check coverage links before trusting RAG for canonical claims.

Do not wait for OKF approval before making documents searchable.

Do not generate OKF directly from arbitrary vector search results.


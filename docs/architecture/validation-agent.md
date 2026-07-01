# Validation Agent

## Purpose

The Validation Agent determines whether a generated answer contains unsupported claims before that answer is shown to the user.

It does not simply check that citations exist. It decomposes the draft answer into claims, classifies each claim, verifies each claim against retrieved evidence and source authority rules, and returns a structured pass/fail report.

The Response Agent may draft text, but the final answer cannot be released until the Validation Agent has checked the claims.

## Core Mechanism

```text
Draft answer
-> Claim extraction
-> Claim typing
-> Citation/evidence matching
-> Source authority validation
-> Review-status validation
-> Confidence scoring
-> Rewrite/block decision
-> Validation report
```

## Inputs

The Validation Agent receives:

```text
user_query
router_decision
draft_answer
retrieved_evidence
okf_objects_used
rag_chunks_used
source_manifest_entries
domain_pack_rules
typed_relations
conversation_context
```

For MVP, `retrieved_evidence` should include:

```text
source_id
source_type
source_title
source_uri
source_page_start
source_page_end
source_excerpt
review_status
source_authority
retrieval_mode
```

## Output

The Validation Agent returns structured JSON:

```json
{
  "status": "fail",
  "overall_confidence": "medium",
  "validated_claims": [
    {
      "claim_id": "c1",
      "text": "The refund window is 14 days.",
      "claim_type": "policy_or_process",
      "status": "supported",
      "supporting_sources": ["src_policy_refunds_p3"],
      "confidence": "high"
    }
  ],
  "blocked_claims": [
    {
      "claim_id": "c2",
      "text": "The aircraft may be dispatched.",
      "claim_type": "dispatch",
      "status": "unsupported_authority",
      "reason": "Dispatch claims require MEL/MMEL or approved dispatch source evidence.",
      "required_sources": ["MEL", "MMEL", "operator_dispatch_rules"],
      "available_sources": ["training"]
    }
  ],
  "missing_evidence": [
    "No approved MEL/MMEL source was retrieved."
  ],
  "required_rewrite": true,
  "safe_answer_mode": "answer_with_limitations"
}
```

Allowed validation statuses:

```text
pass
fail
needs_clarification
```

Allowed claim statuses:

```text
supported
unsupported_no_citation
unsupported_weak_match
unsupported_authority
unsupported_review_status
unsupported_conflict
unsupported_missing_context
out_of_scope
```

Allowed safe answer modes:

```text
release_as_written
rewrite_with_limitations
answer_with_missing_evidence
ask_clarifying_question
refuse_unsupported_request
```

## Step 1: Claim Extraction

The validator first extracts atomic claims from the draft answer.

An atomic claim is a single statement that can be checked against evidence.

Examples:

```text
"The refund window is 14 days."
"The relevant ATA chapter is 24."
"The source manual path is QRH first, then FIM/AMM for troubleshooting."
"The aircraft can be dispatched."
"The IDG disconnect switch must be pushed."
```

Do not validate whole paragraphs as one claim. Split compound statements.

Bad:

```text
"For GEN OFF BUS, use ATA 24, check the QRH, and dispatch is allowed."
```

Good:

```text
"GEN OFF BUS maps to ATA 24."
"The QRH is the first source for an active abnormal condition."
"Dispatch is allowed."
```

MVP extraction approach:

```text
1. Use deterministic sentence splitting as the first pass.
2. Merge fragments that are not standalone claims.
3. Use an LLM extractor to convert the draft into claim JSON.
4. Keep the original answer span for each claim so blocked claims can be removed or rewritten.
```

Claim extraction output:

```json
{
  "claim_id": "c1",
  "text": "GEN OFF BUS maps to ATA 24.",
  "answer_span": {
    "start": 42,
    "end": 66
  }
}
```

## Step 2: Claim Typing

Each claim receives a type. Claim type determines the evidence required.

Generic claim types:

```text
definition
policy_or_process
source_lookup
summary
comparison
historical_observation
recommendation
live_data
```

Aviation claim types:

```text
ata_classification
manual_path
dispatch
maintenance_procedure
troubleshooting
wiring
parts
effectivity
limitation
training_explanation
```

Claim type output:

```json
{
  "claim_id": "c3",
  "claim_type": "dispatch",
  "risk_level": "high"
}
```

Risk levels:

```text
low
medium
high
critical
```

Default rule:

```text
High-risk and critical claims require stricter source authority and approved review status.
```

## Step 3: Citation And Evidence Matching

The validator checks whether each claim is supported by retrieved evidence.

This is not just "does the answer include a citation." It checks:

```text
Does the cited source exist?
Was the source actually retrieved/read?
Does the cited source text support the claim?
Does the cited source page range cover the cited statement?
Is the support direct or inferential?
Does another approved source conflict with it?
Do typed relations change how the candidate should be treated?
```

Evidence match levels:

```text
direct
inferential
weak
none
conflict
```

MVP matching mechanism:

```text
1. For each claim, gather candidate evidence from the retrieved sources.
2. Prefer pre-extracted structured facts when available.
3. Fall back to raw source excerpts when no structured fact exists.
4. Run lexical checks for exact entities, numbers, terms, units, dates, identifiers, and negations.
5. Run semantic similarity between the claim and each evidence candidate.
6. Use an LLM judge only after lexical/semantic candidates are selected.
7. Require direct support for high-risk claims.
```

## What Semantic Similarity Means

Semantic similarity is a candidate selection step, not the final proof that a claim is supported.

It compares the normalized claim text against normalized evidence candidates using embeddings or another semantic retrieval score. The evidence candidates may be:

```text
structured facts extracted from OKF or topic records
raw source excerpts from retrieved document pages
table rows or normalized table facts
warning/caution/note blocks
source manifest entries
domain rule entries
```

Use this evidence preference order:

```text
1. Approved structured fact from OKF
2. Approved source manifest or domain rule
3. Approved topic record field
4. Raw source excerpt with page reference
5. Unreviewed topic record or RAG chunk, discovery only
```

For canonical answers, the validator should compare against approved structured facts first. For open-ended RAG answers, the validator may compare against raw excerpts because a curated fact may not exist.

Approved OKF concepts may link back to the RAG chunks and source pages they cover. When a RAG chunk is covered by an approved OKF concept, the validator should treat the OKF concept as the controlling source for canonical claims and the RAG chunk as supporting context only.

Typed relations should guide candidate interpretation:

```text
routes_to = strong manual-path or workflow routing signal
references = weak context signal only
supports = possible evidence signal, still subject to authority checks
covered_by = controlling OKF concept should be checked before raw RAG
supersedes = older target should not support current claims
conflicts_with = conflict must be resolved before release
depends_on = missing target can create missing-context or missing-evidence status
```

A plain Markdown link or legacy `related_topics` entry is not enough to prove source authority. For high-risk claims, the validator should prefer typed relations over untyped links when deciding whether a retrieved object is evidence, background, a route, or a conflict.

The LLM judge compares the claim against the selected evidence candidates, not against the whole corpus. It must return:

```json
{
  "claim_id": "c1",
  "evidence_id": "src_policy_refunds_p3",
  "match_level": "direct",
  "supports_claim": true,
  "exact_evidence_excerpt": "Customers may request a refund within 14 days of purchase.",
  "reason": "The source explicitly states the same refund window as the claim."
}
```

The LLM judge is not allowed to invent evidence. If it cannot quote or identify the exact supporting excerpt, the match level is `weak` or `none`.

## Lexical, Semantic, And Judge Disagreements

The validator should be conservative when checks disagree.

Disagreement rules:

```text
Lexical says conflict, semantic says similar:
  treat as conflict until the LLM judge proves direct support.

Lexical says exact number/date/identifier mismatch:
  block the claim, even if semantic similarity is high.

Lexical says entity/source mismatch:
  block or require clarification unless the judge identifies an explicit alias.

Semantic says high similarity, judge says unsupported:
  mark unsupported_weak_match.

Semantic says low similarity, judge says supported:
  allow only if the judge cites an exact excerpt and the claim is low or medium risk.

Judge says supported, authority check fails:
  block as unsupported_authority.

Judge says supported, review-status check fails:
  block as unsupported_review_status or label as unreviewed discovery for low-risk answers.

Approved structured fact conflicts with raw RAG excerpt:
  prefer approved structured fact and record unsupported_conflict for the conflicting raw evidence.

Approved OKF concept covers the RAG chunk:
  trust the OKF concept for canonical claims and use the RAG chunk only as source context.
```

For high-risk or critical claims, the strictest check wins:

```text
lexical mismatch OR weak semantic match OR judge uncertainty OR authority failure OR unapproved source
= blocked claim
```

Evidence scoring:

```text
direct support = claim is explicitly stated by source
inferential support = claim follows from nearby source text
weak support = source is related but does not prove the claim
none = no source supports it
conflict = approved source contradicts the claim
```

Minimum evidence thresholds:

```text
low-risk claim: inferential or direct support
medium-risk claim: direct support preferred, inferential allowed with limitation
high-risk claim: direct support required
critical claim: direct support plus approved source authority required
```

## Step 4: Source Authority Validation

A claim may be textually supported but still unsupported because the wrong source type was used.

Example:

```text
Training material may explain a system, but it cannot authorize a maintenance procedure or dispatch conclusion.
```

Generic source authority categories:

```text
approved_policy
approved_procedure
training
reference
historical_record
draft
unknown
live_api
```

Aviation source authority categories:

```text
QRH
MEL
MMEL
AMM
FIM
TSM
CMM
WDM
SSM
IPC
Training
Company
Unknown
```

Authority matrix examples:

| Claim type | Required authority | Block if only source is |
| --- | --- | --- |
| `dispatch` | MEL, MMEL, approved operator dispatch rules | Training, AMM, QRH, Unknown |
| `maintenance_procedure` | AMM, FIM, TSM, CMM | Training, QRH, Unknown |
| `wiring` | WDM, SSM | Training, AMM-only summary, Unknown |
| `parts` | IPC or approved parts source | Training, AMM-only prose, Unknown |
| `training_explanation` | Training, AMM system description, SDS | Unknown |
| `manual_path` | routing rule, source manifest, approved domain rule | raw chunk only |

For MVP, these rules can live in a domain pack config file. The generic validator should call domain-specific authority checks when a domain pack is active.

## Step 5: Review-Status Validation

The validator must check whether a source is approved.

Review statuses:

```text
raw_extracted
needs_ai_cleanup
needs_human_review
approved
rejected
deprecated
```

Rules:

```text
Approved OKF can support direct answers.
Unreviewed RAG chunks can support discovery but not official conclusions.
Rejected and deprecated knowledge cannot support answers.
Safety-critical claims require approved sources.
```

If a claim is supported only by unreviewed content, the claim status is:

```text
unsupported_review_status
```

or, for low-risk exploratory answers:

```text
supported_with_unreviewed_label
```

## Step 6: Confidence Scoring

Each claim receives a confidence score derived from evidence quality and authority.

Claim confidence factors:

```text
evidence_match_level
source_authority_match
source_review_status
source_recency_or_revision
number_of_independent_sources
domain_risk_level
conflicts_found
```

Suggested scoring:

```text
high = direct support + correct authority + approved/reliable source + no conflict
medium = direct/inferential support + acceptable authority + no conflict
low = weak support, unreviewed source, missing authority, or ambiguity
blocked = no support, wrong authority, conflict, rejected/deprecated source
```

Release thresholds:

```text
low-risk answer: medium or higher
medium-risk answer: medium or higher, with limitation if inferential
high-risk answer: high only
critical answer: high plus domain authority pass
```

## Step 7: Unsupported Claim Detection

A claim is unsupported when any of these are true:

```text
No citation exists for a factual claim.
The citation was not part of retrieved evidence.
The cited text does not directly or inferentially support the claim.
The source authority is wrong for the claim type.
The source review status is insufficient.
The claim depends on missing user context.
The claim conflicts with an approved source.
The claim requires live data but only static documents were used.
The claim is outside the platform's allowed scope.
```

Unsupported claim examples:

```text
Claim: "The aircraft can be dispatched."
Evidence: training document about the fault.
Status: unsupported_authority.

Claim: "The refund window is 30 days."
Evidence: no cited policy.
Status: unsupported_no_citation.

Claim: "Use task 24-11-00-700-802."
Evidence: raw unreviewed AMM extraction only.
Status: unsupported_review_status for direct procedural answer.

Claim: "Inventory has 12 units available."
Evidence: OKF product description from last month.
Status: unsupported_missing_context or live_data_required.
```

## Step 8: Rewrite Or Block

The validator does not need to write the final answer, but it must tell the Response Agent what to do.

Decision rules:

```text
All claims supported -> release_as_written
Minor unsupported low-risk claims -> rewrite_with_limitations
Missing evidence for core answer -> answer_with_missing_evidence
Missing required user context -> ask_clarifying_question
High-risk unsupported claim -> refuse_unsupported_request or remove blocked claim
```

Rewrite instruction example:

```json
{
  "required_rewrite": true,
  "safe_answer_mode": "answer_with_missing_evidence",
  "rewrite_instructions": [
    "Remove the dispatch conclusion.",
    "State that no MEL/MMEL evidence was available.",
    "Keep the ATA classification because it is supported by approved routing rules."
  ]
}
```

## Stage Boundaries

For MVP, implement validation in two levels.

### Level 1: Deterministic Validation

Checks:

```text
Every factual claim has at least one citation.
Cited source exists in retrieved evidence.
Source review status is not rejected or deprecated.
High-risk claim types require approved source status.
Domain authority matrix passes.
```

### Level 2: Evidence Match Validation

Checks:

```text
Claim text is matched to supporting source excerpt.
Evidence match level is direct, inferential, weak, none, or conflict.
Low-confidence claims are blocked or rewritten.
```

Level 2 can use an LLM judge, but the judge must return structured JSON and cite the exact evidence excerpt it used.

## Trace Requirements

Persist the validation report in the agent trace:

```text
claims_extracted
claim_types
claim_risk_levels
supporting_sources
evidence_match_levels
authority_results
review_status_results
blocked_claims
missing_evidence
safe_answer_mode
validator_version
```

The UI should show a concise validation status:

```text
Validated
Validated with limitations
Missing evidence
Blocked unsupported claim
Needs clarification
```

## Non-Goals

The Validation Agent is not responsible for:

```text
retrieving new evidence after validation fails
approving unreviewed knowledge
making domain policy
performing live external actions
silently rewriting high-risk claims without trace
```

If validation fails because evidence is missing, the system may run a controlled follow-up retrieval in a later iteration, but MVP should first return a missing-evidence answer.

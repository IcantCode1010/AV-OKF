# Query Router

## Purpose

The query router decides which knowledge path should answer a user question before retrieval happens.

The router is a control point. It prevents the system from blindly running both OKF and RAG for every question, which can increase cost, add irrelevant context, and weaken answer precision.

## Router Principle

```text
Canonical question -> OKF
Open-ended question -> RAG
Mixed question -> Hybrid
Missing or ambiguous context -> Ask one combined clarification, then continue with disclosed bounded assumptions if needed
```

Hybrid is not the default. Hybrid is used only when the answer needs both a curated concept and supporting raw evidence.

## Inputs

The router should receive:

```text
user_query
workspace_id
active_collection_ids
available_okf_indexes
available_rag_indexes
selected_domain_pack
user_context
conversation_context
```

For MVP, `user_context` and `conversation_context` can be minimal.

## Outputs

The router should return a structured decision:

```json
{
  "route": "okf_only",
  "query_category": "canonical_definition",
  "confidence": "high",
  "rationale": "The user asks for an official definition that should be answered from approved structured knowledge.",
  "required_context": [],
  "constraints": {
    "approved_only": true,
    "include_unreviewed": false
  }
}
```

Allowed routes:

```text
okf_only
rag_only
hybrid
missing_context
unsupported
```

Allowed confidence values:

```text
high
medium
low
```

## Query Categories

Use these initial categories:

```text
canonical_definition
policy_or_process
source_lookup
open_ended_discovery
cross_document_summary
comparison
high_risk_domain
live_or_fresh_data
missing_context
unsupported
```

## Route Selection Rules

### OKF Only

Use OKF when the user asks for stable, official, reviewed knowledge.

Examples:

```text
What is our refund window?
What is the official definition of active user?
What is the approved manual path for GEN OFF BUS?
Which source is authoritative for this process?
```

Router output:

```json
{
  "route": "okf_only",
  "query_category": "canonical_definition",
  "confidence": "high"
}
```

### RAG Only

Use RAG when the user asks for broad discovery, similar examples, summaries, or search across raw material.

Examples:

```text
Have we seen this issue before?
Find every document that mentions reset procedures.
Summarize recurring complaints across these support tickets.
Compare all contracts that mention cancellation.
```

Router output:

```json
{
  "route": "rag_only",
  "query_category": "open_ended_discovery",
  "confidence": "high"
}
```

### Hybrid

Use Hybrid when OKF should provide the governing concept, rule, definition, or route, and RAG should provide supporting examples or raw evidence.

Examples:

```text
What is the official refund policy, and which customer tickets complained about it?
What is the GEN OFF BUS manual path, and where do the manuals mention related generator faults?
Use the approved escalation process and find recent examples that match this case.
```

Router output:

```json
{
  "route": "hybrid",
  "query_category": "comparison",
  "confidence": "medium"
}
```

### Missing Context

Use missing context when the answer depends on information the user has not supplied.

Examples:

```text
Can we approve this?
What procedure should I use?
Is this covered?
```

Across mixed document domains, these may require the subject or entity, applicable scope or version, source authority, or intended action. High-risk action questions use the same combined context check before retrieval.

Router output:

```json
{
  "route": "missing_context",
  "query_category": "missing_context",
  "confidence": "high",
  "required_context": [
    "subject_or_entity",
    "applicable_scope_or_version",
    "source_authority",
    "intended_action"
  ]
}
```

### One-Round Clarification Policy

Clarification is capped at one assistant request per chat session. The service determines whether that round was used by inspecting persisted assistant traces for `route: "missing_context"`; no counter column is required.

If the next reply supplies enough context, routing and retrieval use those values normally. If context is still incomplete, the router cannot return `missing_context` again. It proceeds through the best available retrieval path, defaulting uncertain decision and high-risk questions to approved OKF first.

Any remaining assumptions are bounded retrieval policy, not invented facts. Conversation-grounded values may refine the search query. Safe defaults may only widen scope to all available subjects/scopes, prefer approved OKF over labeled raw discovery, and limit the intended action to informational guidance. Every assumption used is stated in the visible answer so the user can correct it.

Safe defaults may widen a real subject-bearing question, but they cannot manufacture a searchable subject. If a later message remains wholly referential or subjectless, such as `What about it?`, the service does not run query optimization, retrieval, reranking, or answer synthesis. It returns a concise recovery instruction asking the user to name the document, topic, policy, product, or other subject. This is not a second formal clarification round, and the trace records `unresolved_vague_follow_up`.

Weak approved OKF candidates may use the same one-round gate for a deterministic metadata clarification. The active bundle profile defines an ordered allowlist of user-answerable fields; when one or two fields partition the near-miss set, the UI offers only values that actually occur in those approved candidates. Internal trust fields such as review status, source authority, revision, lifecycle, and relations are never clarification axes.

Near misses are diagnostic records, not evidence. They contain only file identity, title, match diagnostics, and allowlisted metadata, and they cannot be passed to answer generation, citation assembly, or answer validation. If the selected follow-up still produces weak or zero qualified OKF evidence, the system cannot ask again: it searches raw RAG with the enriched query and labels any result as unreviewed discovery. It uses the honest-miss response only when that RAG search is also empty.

The visible follow-up transcript uses natural field labels, for example `Subject or family: Forklift; Document type: Operations Manual.` The structured field IDs and selected values remain in the persisted trace for auditability.

### Unsupported

Use unsupported when the question asks for something the platform should not answer from documents alone.

Examples:

```text
Make a legal decision for me.
Tell me today's inventory count without an inventory API.
Approve this aircraft for dispatch without MEL evidence.
```

Router output:

```json
{
  "route": "unsupported",
  "query_category": "unsupported",
  "confidence": "high"
}
```

## Fallback Rules

If router confidence is `low` and the session has not clarified yet, ask one combined clarification question instead of retrieving broadly. After that round, continue with the original question, follow-up context, and disclosed bounded assumptions rather than asking again.

Query optimization runs only for genuinely ambiguous, missing-context, or LLM-fallback routes. Clear high-confidence questions skip the provider call. There is no per-workspace daily optimization counter.

If the route is `okf_only` but no approved OKF object exists, return missing evidence or downgrade to `rag_only` only for discovery. Do not present RAG as official truth.

If the route is `rag_only` but the retrieved evidence conflicts with approved OKF, prefer OKF and show the conflict in the trace.

If the route is `hybrid`, read OKF first, then use RAG only for the specific evidence gap.

## Trace Requirements

Every routed query should persist:

```text
route
query_category
router_confidence
router_rationale
required_context
retrieval_tools_called
sources_read
whether_approved_okf_was_available
whether_rag_was_used_for_discovery_only
final_evidence_status
```

The UI should expose a concise trace label:

```text
Routed to OKF
Routed to RAG
Routed to Hybrid
Missing context
Unsupported
```

## MVP Implementation Notes

Start with a rules-first router plus an LLM fallback.

Rules should catch obvious cases:

```text
definition/policy/process/source/manual path -> OKF
find all/summarize/compare/similar/seen before -> RAG
official plus examples/recent cases/supporting evidence -> Hybrid
can we/should I/procedure/dispatch without context -> Missing Context
```

Use an LLM classifier only when rules do not produce a high-confidence route.

The first router does not need to be perfect. It needs to be inspectable, traceable, and conservative.

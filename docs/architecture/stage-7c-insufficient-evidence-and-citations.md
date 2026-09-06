# Stage 7C Insufficient Evidence And Citation Navigation

## Insufficient Evidence

An assistant response has an explicit `answerOutcome`. When retrieval returns no evidence, or the answer model reports that related evidence does not directly answer the question, the outcome is `insufficient_evidence`.

That outcome:

- produces a deterministic statement of what was searched and what the user can provide next;
- may retain related sources for inspection, but cannot cite them as answer support;
- renders as blocked/no-answer evidence rather than an approved-answer badge;
- creates one bundle-scoped `KnowledgeGap` in the same transaction as the assistant message.

Open gaps are listed in the existing knowledge-bundle page for reviewer follow-up. Retrieval outages are not knowledge gaps because they represent system availability, not missing corpus coverage.

## Reviewed Retrieval Triggers

When an insufficient-evidence turn has a specific approved OKF near miss, the
system may stage a small set of normalized query terms as a search-alias
proposal for that concept. The proposal contains no concept body and is bound
to the authenticated workspace, selected bundle, normalized concept path, and
the exact hash of the live concept file.

The proposal is retrieval-inert until a reviewer approves it from the bundle's
**Review > Knowledge gaps** view. Approval revalidates the live active bundle,
approved topic mapping, document assignment, safe path, and content hash. An
approved alias participates only in lexical discovery; it does not modify OKF
Markdown, trust, lifecycle, answer text, citations, or graph relations.

Pending, rejected, or stale proposals never enter retrieval. A changed concept
hash disables its previously approved aliases automatically. Near-miss
diagnostics remain a separate type from qualified evidence and cannot be passed
to answer generation, deterministic validation, or citation assembly.

## Citation Navigation

Raw-document citations carry `documentId` and link to:

```text
/api/documents/{documentId}/file#page={pageStart}
```

The route requires an authenticated workspace context, verifies document ownership before reading bytes, and streams the PDF inline without exposing its object-storage key.

OKF citations carry `knowledgeBundleId` and `okfFilePath` and link to the selected file in the bundle explorer.

When a stored chat is reopened, citation lifecycle state is resolved again. Deleted, retracted, archived, or temporarily unverifiable sources remain visible with a notice, but their links are disabled.

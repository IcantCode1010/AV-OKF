# Stage 7C Insufficient Evidence And Citation Navigation

## Insufficient Evidence

An assistant response has an explicit `answerOutcome`. When retrieval returns no evidence, or the answer model reports that related evidence does not directly answer the question, the outcome is `insufficient_evidence`.

That outcome:

- produces a deterministic statement of what was searched and what the user can provide next;
- may retain related sources for inspection, but cannot cite them as answer support;
- renders as blocked/no-answer evidence rather than an approved-answer badge;
- creates one bundle-scoped `KnowledgeGap` in the same transaction as the assistant message.

Open gaps are listed in the existing knowledge-bundle page for reviewer follow-up. Retrieval outages are not knowledge gaps because they represent system availability, not missing corpus coverage.

## Citation Navigation

Raw-document citations carry `documentId` and link to:

```text
/api/documents/{documentId}/file#page={pageStart}
```

The route requires an authenticated workspace context, verifies document ownership before reading bytes, and streams the PDF inline without exposing its object-storage key.

OKF citations carry `knowledgeBundleId` and `okfFilePath` and link to the selected file in the bundle explorer.

When a stored chat is reopened, citation lifecycle state is resolved again. Deleted, retracted, archived, or temporarily unverifiable sources remain visible with a notice, but their links are disabled.

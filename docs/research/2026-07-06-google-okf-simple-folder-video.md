# Google's OKF: The Simple Folder Replacing Vector Databases

## Source

- URL: https://www.youtube.com/watch?v=2kKkb01GxYQ
- Author / Publisher: Cloud Codes
- Provider: YouTube
- Date reviewed: 2026-07-06
- Topic: OKF as a filesystem-native knowledge layer for agents

## Summary

This user-supplied video reference appears to discuss Google's Open Knowledge Format as a simple folder-based knowledge structure that can complement or reduce dependence on vector-database-only retrieval.

The source is relevant because AV-OKF is now moving in that exact direction: chat should retrieve approved OKF evidence from the exported `knowledge/` bundle directly, while raw RAG remains the fallback for unreviewed source-document discovery.

## Key Ideas

- OKF can be represented as ordinary Markdown files in a folder structure.
- Agent-readable knowledge does not always need to start as vector embeddings.
- The filesystem bundle can become a portable, inspectable source of curated knowledge.
- RAG still remains useful for broad recall over raw extracted documents.

## Relevance To AV-OKF

This supports the Stage 6.5 decision to treat the exported OKF bundle as the authoritative reviewed knowledge layer. The app should not require approved OKF topics to be copied into the RAG database before an agent can use them.

For AV-OKF, this maps to:

```text
approved topic -> exported OKF Markdown file -> live bundle retriever -> chat/agent evidence
raw extracted PDF text -> RAG index -> discovery/supporting evidence
```

## Product Impact

Confirms current direction.

No roadmap pivot is needed. The current architecture already separates:

- reviewed OKF bundle retrieval
- raw RAG retrieval
- evidence cards that label answer provenance
- future validation logic that can prefer approved OKF over raw chunks

## Recommended Action

Keep this as a reference for the Agent-Ready OKF Bundle Retriever and Stage 7 validation work.

Do not interpret the video title literally as "replace vector databases everywhere." In AV-OKF, OKF and RAG serve different jobs:

- OKF: reviewed, structured, curated knowledge
- RAG: broad recall over raw source documents

## Related Project Areas

- OKF bundle
- Knowledge explorer
- Agent-ready OKF retriever
- Chat agent
- RAG retrieval
- Validation

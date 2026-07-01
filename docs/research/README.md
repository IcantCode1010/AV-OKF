# Research Notes

This folder stores article, video, and reference reviews that may influence AV-OKF product direction.

Use this folder for external material about:

- OKF and structured knowledge
- RAG and retrieval systems
- Agent frameworks
- Document management platforms
- AI chat interfaces
- Data extraction and ingestion
- Validation, citations, and trust layers
- Domain-specific knowledge systems

## Review Policy

Each review should answer:

1. What is the source?
2. What is the core idea?
3. Does it support the current AV-OKF direction?
4. Does it suggest a change to the roadmap?
5. What should we do now, later, or ignore?

The default stance is to avoid changing direction for every new article. A source should affect the roadmap only when it improves the product architecture, reduces risk, clarifies implementation order, or exposes a major missing capability.

## Recommended File Naming

Use this format:

```text
YYYY-MM-DD-short-source-title.md
```

Examples:

```text
2026-06-30-okf-vs-rag-memory-problems.md
2026-07-01-papra-document-management-reference.md
2026-07-01-langgraph-agent-orchestration.md
```

## Review Template

```md
# Source Title

## Source

- URL:
- Author / Publisher:
- Date reviewed:
- Topic:

## Summary

Short plain-language summary of the source.

## Key Ideas

- Idea 1
- Idea 2
- Idea 3

## Relevance To AV-OKF

Explain how this applies to the platform.

## Product Impact

Use one of:

- No change
- Confirms current direction
- Minor roadmap adjustment
- Major architecture concern
- Future consideration

## Recommended Action

What should be done because of this source.

## Related Project Areas

- Document vault
- Extraction pipeline
- Topic records
- OKF bundle
- RAG retrieval
- Chat agent
- Validation
- Domain packs
```


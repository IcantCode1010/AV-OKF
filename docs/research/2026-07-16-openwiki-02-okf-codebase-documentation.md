# OpenWiki 0.2: OKF for Codebase Documentation

Source: [LangChain announcement](https://www.langchain.com/blog/openwiki-0-2-adds-okf-support)

Reviewed: 2026-07-16

## Summary

OpenWiki generates and maintains repository documentation for coding agents. Version 0.2 emits that wiki as an OKF-style Markdown hierarchy with YAML frontmatter, generated directory indexes, and update logs. Agent instruction files such as `AGENTS.md` or `CLAUDE.md` point agents toward the wiki.

## Relevance to AV-OKF

The article confirms several architectural decisions already present in AV-OKF:

- OKF remains a filesystem-native knowledge source that agents can inspect without a vector database.
- Structured metadata supports deterministic filtering before expensive semantic or agentic search.
- Hierarchical `index.md` files provide progressive disclosure for large bundles.
- Change logs let an agent inspect recent updates instead of rereading an entire bundle.
- The knowledge producer and the agent-facing retriever should remain separate components.

The useful new pattern is **source-aware maintenance**. OpenWiki can refresh generated documentation as code changes. AV-OKF should eventually apply the same principle to source documents: detect a source revision, mark derived topics and exports stale, regenerate drafts, and require review before replacing trusted OKF knowledge.

## Differences and Cautions

- OpenWiki targets code repositories; AV-OKF targets arbitrary uploaded documents and requires stronger provenance, review, lifecycle, and source-page controls.
- OpenWiki's article examples use fields such as `resource` and `timestamp`. AV-OKF should keep its adopted generic contract (`type`, `title`, `description`, `tags`, `updated`) and treat canonical resource links as optional profile extensions.
- The article refers to both `logs.md` and `log.md`. AV-OKF should retain the reserved `log.md` filename used by its manifest, validators, exporter, and current OKF specification.
- OpenWiki's generated content should not bypass AV-OKF approval. Imported or generated concepts remain untrusted until provenance and review requirements are satisfied.

## Product Impact

No immediate architecture change is required. Add future consideration for:

1. Source-revision detection and stale-knowledge status.
2. Incremental topic rediscovery instead of full document regeneration when practical.
3. Agent-readable bundle update summaries derived from `log.md`.
4. Optional instruction/export files that tell external agents how to locate and query a selected AV-OKF bundle.


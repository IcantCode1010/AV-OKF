# Introducing the Open Knowledge Format

## Source

- URL: https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing/
- Author / Publisher: Sam McVeety and Amir Hormati, Google Cloud
- Published: 2026-06-12
- Date reviewed: 2026-07-01
- Topic: OKF as a portable, agent-readable knowledge format

## Summary

Google introduces Open Knowledge Format (OKF) as a vendor-neutral way to represent curated knowledge for humans and AI agents. OKF is deliberately simple: a bundle is a directory of Markdown files with YAML frontmatter, where each file represents one concept. The format is intended to solve repeated context assembly for agents by making stable knowledge portable, version-controlled, linkable, and easy for agents to navigate.

## Key Ideas

- OKF is a format, not a platform.
- A bundle is just files: Markdown plus YAML frontmatter.
- Each concept should live in one Markdown file.
- The only required frontmatter field is `type`.
- Optional structured fields include title, description, resource, tags, and timestamp.
- Files link to each other with normal Markdown links, forming a navigable knowledge graph.
- `index.md` files support progressive disclosure, so agents can inspect the knowledge hierarchy before opening every file.
- `log.md` files can track bundle changes chronologically.
- Producers and consumers are independent: one tool can generate the bundle, while another tool, viewer, search system, or agent can consume it.
- OKF v0.1 is early and intentionally minimal.

## Relevance To AV-OKF

This article strongly supports the AV-OKF architecture. Our platform should treat OKF as a first-class output from document ingestion, not as an optional export at the end.

The current direction remains correct:

```text
Raw documents
-> extraction
-> topic records
-> human review
-> approved OKF bundle
-> agent-readable knowledge
```

The article also reinforces that OKF should not be confused with RAG. OKF is curated stable knowledge. RAG remains useful for broad discovery across raw or semi-structured documents.

## Product Impact

Confirms current direction.

No major roadmap change is needed. The article does suggest one refinement: the MVP should explicitly include an OKF bundle browser or preview, not only a behind-the-scenes exporter.

## Recommended Action

Keep the staged roadmap, but sharpen Stage 5:

- Generate `index.md` files as part of OKF export.
- Generate a `log.md` change history for exported bundles.
- Add a simple OKF bundle preview in the UI.
- Preserve producer/consumer separation: ingestion should create topic records; the OKF exporter should turn approved records into Markdown; the agent should consume OKF through explicit read/navigation tools.

## Related Project Areas

- Topic records
- OKF bundle
- RAG retrieval
- Chat agent
- Validation
- Review workflow

## Notes For Agent Architecture

The agent should use progressive disclosure:

```text
1. Read workspace or bundle index.
2. Open relevant domain or collection indexes.
3. Read only the needed OKF files.
4. Use RAG when the question is exploratory or OKF does not contain enough evidence.
5. Validate final claims against source references and review status.
```

This points toward a controlled workflow agent with explicit tools:

- `list_okf_indexes`
- `read_okf_file`
- `follow_okf_links`
- `search_rag`
- `read_source_manifest`
- `validate_claims`
- `log_trace`


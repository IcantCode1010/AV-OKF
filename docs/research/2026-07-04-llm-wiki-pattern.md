# LLM Wiki Pattern

## Source

- URL: https://datasciencedojo.com/blog/llm-wiki-tutorial/?utm_campaign=9062674-Social%20Media%20Marketing&utm_source=linkedin&utm_medium=social&utm_term=llm_wiki_tutorial&utm_content=blog
- Author / Publisher: Data Science Dojo Staff
- Published: 2026-04-16
- Date reviewed: 2026-07-04
- Topic: LLM-maintained Markdown wiki as a compounding knowledge base

## Summary

The article explains an "LLM wiki" pattern: keep raw source files in one folder and let an LLM compile a second folder of Markdown entity pages. Each page represents one concept, links to related pages, and is updated as new sources are added. The key idea is that knowledge compounds over time because the structured wiki is rewritten and connected, rather than rediscovered from raw documents on every question.

The article contrasts this with RAG. RAG is better for fast Q&A over changing source material and strong source traceability. The wiki pattern is better for slower, growing knowledge areas where synthesis and concept relationships matter.

## Key Ideas

- Raw sources and compiled knowledge should be separate.
- Adding a source should update existing concept pages, create new pages, add links, and flag contradictions.
- The compiled knowledge layer becomes more useful as it grows because relationships are preserved.
- Entity pages should stay narrow and concept-focused; oversized pages weaken navigation and linking.
- A maintenance or linting pass is needed so the wiki does not drift into inconsistency.
- `index.md` and `log.md` become important once the wiki grows beyond a small starter set.

## Relevance To AV-OKF

This strongly overlaps with AV-OKF's current architecture:

```text
raw PDFs / extracted pages -> RAG
reviewed topic records -> OKF Markdown files
OKF bundle index/log/source manifest -> navigable compiled knowledge layer
agent router -> decides when to use compiled OKF vs raw RAG
validator -> prevents unsupported generated answers
```

The article supports the decision to build OKF separately from RAG. It also reinforces why the Knowledge page should expose a bundle explorer rather than a flat file list: users need to understand the compiled knowledge structure, not just inspect raw files.

## Product Impact

Confirms current direction with a future consideration.

No immediate roadmap pivot is needed. AV-OKF is already implementing the stronger version of this pattern: Markdown knowledge files plus frontmatter schema, bundle index, log, source manifest, relation lint, and OKF-to-RAG coverage links.

The gap to consider later is a maintenance workflow for the compiled bundle:

- detect stale or orphaned OKF files
- surface contradictions between new source material and approved OKF
- propose updates to existing approved topics
- require human review before the bundle changes

## Recommended Action

Keep the current roadmap order:

1. Finish Stage 6 chat agent routing and retrieval.
2. Build Stage 7 validation before letting the agent make stronger claims.
3. Treat LLM-wiki-style maintenance as a later OKF bundle maintenance feature, not as part of the first chat agent.

Do not adopt the article's informal wiki approach wholesale. AV-OKF needs stricter controls:

- approved OKF must remain human-reviewed
- generated links must be typed where operational meaning matters
- source authority and revision metadata must be explicit
- every agent answer needs citation and validation behavior

## Related Project Areas

- OKF bundle
- Knowledge explorer
- Topic records
- RAG retrieval
- Chat agent
- Validation
- Bundle maintenance

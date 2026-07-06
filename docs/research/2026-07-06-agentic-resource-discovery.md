# Agentic Resource Discovery

## Source

- URL: https://agenticresourcediscovery.org/
- Author / Publisher: Agentic Resource Discovery working group
- Date reviewed: 2026-07-06
- Topic: Discovering agentic resources before invoking them

## Summary

Agentic Resource Discovery (ARD) is an open discovery protocol for finding agentic resources before an agent invokes them. An agentic resource can be an agent, MCP server, skill, plugin, API, workflow, or another callable capability.

The core idea is not "run the tool." The core idea is "find the right callable resource for this task." ARD sits before invocation and gives AI clients a search layer over available resources.

## Key Ideas

- ARD is a discovery layer, not an execution runtime.
- Resources are described with catalog metadata: what they do, who provides them, where they live, and how they are reached.
- Discovery should scale beyond stuffing every tool description into an LLM context window.
- Enterprises will usually want a governed, approved internal collection rather than open-web discovery.
- A discovery service can expose endpoints such as `POST /search`, optional `POST /explore`, and optional `GET /agents`.
- The discovery layer should stay separate from authentication, execution, and resource-specific protocols.

## Relevance To AV-OKF

ARD applies to AV-OKF as the future "capability discovery" layer for the agent system.

AV-OKF already has several internal capabilities that an agent may need to choose between:

- live OKF bundle retrieval
- raw RAG retrieval
- source PDF/page lookup
- validation against citations
- topic enrichment
- OKF export
- document extraction
- reindexing
- future aircraft/domain-specific agents

Today, the router is mostly hardcoded logic. ARD suggests a more scalable future shape: describe each internal capability as a resource, then let the agent/query router search a governed resource catalog to decide what capability should handle a task.

## Product Impact

Future consideration with a likely Stage 7/8 roadmap impact.

This does not replace OKF or RAG. It sits above them:

```text
user question
-> query router / agent planner
-> resource discovery layer
-> selected resource:
   - OKF bundle retriever
   - raw RAG retriever
   - source PDF lookup
   - validation agent
   - enrichment workflow
```

## Recommended Action

Do not implement ARD immediately inside the current Stage 6.5 OKF retriever work. The immediate priority remains:

1. finish live OKF bundle retrieval
2. make chat evidence source labeling reliable
3. build validation behavior around OKF vs raw RAG evidence

After that, add a planning slice for an internal AV-OKF capability catalog:

- `/.well-known/ai-catalog.json` or internal equivalent
- `/api/resources/search`
- catalog entries for OKF retriever, raw RAG retriever, source document lookup, validation, enrichment, and export
- trust labels for approved internal capabilities
- audit logs for which resource the agent selected and why

## Related Project Areas

- Agent infrastructure
- Query router
- OKF bundle retriever
- RAG retrieval
- Validation agent
- Source document viewer
- Audit trail
- Future MCP / agent integrations

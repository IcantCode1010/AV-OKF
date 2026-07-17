# Knowledge Explorer V2

## Purpose

The Knowledge Explorer is the human-facing view of the active OKF bundle. It combines the physical Markdown file tree, the typed-relation graph, and a rendered file reader without changing the bundle or creating another source of truth.

The interaction model was informed by [`saschb2b/okf-viewer`](https://github.com/saschb2b/okf-viewer), an MIT-licensed OKF-specific viewer. AV-OKF borrows its synchronized tree/graph/reader pattern and derived backlinks, while keeping the existing Next.js, shadcn, TypeScript, lifecycle, parser, and server-action architecture. Its Tauri/Rust backend and custom canvas renderer are not transplanted.

## Shared Selection

`/knowledge/bundle?file=<bundle-relative-path>` is the canonical selection state.

- Tree file rows select a file.
- Graph nodes select their concept file.
- Reader Markdown links select supported internal files.
- Outgoing relation and incoming backlink rows select the related file.
- Browser back and forward restore selection through the URL.
- Unsafe, missing, or inactive selections fall back to `index.md`, then the first active concept, then the first active Markdown file.

Graph topology is initialized from node and edge identities. Selection changes update focus, highlights, labels, and centering without rebuilding the simulation.

## Projection Rules

`okf-explorer.ts` builds a read-only server projection from the live bundle:

- Reuses `parseOkfMarkdown`; it does not define another frontmatter parser.
- Reuses realpath-aware knowledge-root resolution.
- Applies the workspace's `OkfConceptLifecycle` projection.
- Excludes archived, retracted, and deleted files completely.
- Includes active reserved files in the physical tree and reader, but not the graph.
- Includes active concept files as graph nodes when `title` and `type` are parseable.
- Builds directed graph edges only from valid typed `relations` frontmatter.
- Derives backlinks by reversing valid edges; backlinks are never written into OKF files.
- Emits warnings for malformed files, unsafe or missing targets, inactive targets, unsupported relations, missing reasons, and target-type mismatches.

The physical file tree mirrors bundle-relative folders. `index.md` is readable but does not redefine physical placement.

## Human Exploration Versus Agent Trust

The explorer and the chat retriever have intentionally different inclusion rules.

- Human explorer: active lifecycle content with parseable concept metadata.
- Trusted agent retrieval: active lifecycle, `review_status: approved`, required OKF fields, and a qualified query match.

An active draft may therefore be visible to a reviewer without becoming evidence for an approved OKF answer. The explorer must never be used as a shortcut around the stricter agent retrieval gates.

## Graph And Reader

The graph is read-only and uses pinned `@cosmos.gl/graph@3.2.0`. WebGL code is imported only by the Client Component. If WebGL initialization fails, the tree, rendered Markdown reader, and relationship modules remain usable.

Markdown is rendered with `react-markdown` and `remark-gfm`; raw HTML is not enabled. Supported relative `.md` links navigate within the bundle. Unsafe or unresolved internal links render as broken, while external HTTP(S) links open in a new tab.

PDF page opening, graph editing, generic Markdown links as graph edges, clustering, and agent-path overlays remain deferred.

## Relation Discovery Boundary

The graph currently renders only reviewed typed relations already present in OKF frontmatter. A separate reviewed relation-discovery slice will propose candidate edges from deterministic bundle signals and optional workspace-LLM classification, but candidates remain outside the trusted graph until a reviewer approves them and the source concept is re-exported successfully.

The Knowledge Explorer may host that review workflow, but it must not become an unrestricted graph editor. Exported `relations` frontmatter remains the source of truth, incoming backlinks remain derived, and pending or rejected candidates must never influence agent graph traversal.

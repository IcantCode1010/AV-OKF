# Link Resolution

## Purpose

AV-OKF depends on links resolving deterministically inside the repository. Ambiguous Markdown parsing would weaken retrieval, graph traversal, typed relations, and validation.

This document defines the AV-OKF Markdown link profile and resolver rules.

## Markdown Profile

AV-OKF knowledge files use CommonMark-compatible Markdown with YAML frontmatter.

Only these link forms are part of the supported knowledge graph:

```markdown
[label](relative/path.md)
[label](../relative/path.md)
[label](relative/path.md#heading-fragment)
```

Reference-style links, shortcut links, autolinks, raw HTML links, wiki links, image links, and bare URLs are not graph links for MVP.

Examples:

| Link | Allowed | Reason |
| --- | --- | --- |
| `[ELT MEL](../manuals/mel/elt.md)` | Yes | Relative Markdown file link. |
| `[ELT MEL](../manuals/mel/elt.md#dispatch)` | Yes | Relative file link with heading fragment. |
| `[ELT MEL](/aircraft/737ng/manuals/mel/elt.md)` | No | Repo-root absolute path is ambiguous across renderers. |
| `[ELT MEL](C:\manuals\elt.md)` | No | Host filesystem path is not portable. |
| `[ELT MEL](https://example.com/elt.md)` | No | External URLs are not internal graph edges. |
| `[ELT MEL][elt-ref]` | No | Reference-style link parsing is out of MVP scope. |
| `[[ELT MEL]]` | No | Wiki links are not CommonMark links. |
| `![ELT diagram](../images/elt.png)` | No | Images are assets, not graph edges. |

## Path Rules

Resolvers must apply these rules:

```text
Resolve links relative to the Markdown file that contains the link.
Normalize "." and ".." path segments before checking existence.
Reject any normalized path that escapes the OKF root.
Use forward slashes in stored links.
Treat paths as case-sensitive for bundle validation.
Percent-decode URL path segments before resolution.
Reject query strings.
Allow fragments only after a resolved Markdown file path.
```

Allowed target file extensions:

```text
.md
```

Asset links may exist in rendered Markdown later, but they are not part of MVP OKF graph traversal unless a separate asset policy is added.

## Fragment Rules

Fragments are optional. If present, they should identify a heading inside the target Markdown file.

MVP fragment handling:

```text
Lowercase the heading text.
Trim leading and trailing whitespace.
Convert spaces to hyphens.
Remove punctuation characters.
Compare against headings in the target file.
```

If the resolver cannot find the fragment target, validation should fail with a broken-link error or warning depending on the lint profile. Aviation-approved bundles should treat unresolved fragments as errors.

## Typed Relation Targets

The `relations[].target` field uses the same resolver rules as Markdown links.

Allowed:

```yaml
relations:
  - relation: routes_to
    target: ../manuals/mel/elt.md
```

Rejected:

```yaml
relations:
  - relation: routes_to
    target: /aircraft/737ng/manuals/mel/elt.md
```

Typed relations may point to source-manifest external references only when the relation entry explicitly uses a future `target_scope: external_manifest` field. Until that field exists, relation targets are internal OKF bundle links.

## Source References Are Not Links

Source files, source pages, RAG chunk IDs, and document IDs are structured references, not Markdown graph links.

Examples:

```yaml
source_file: B737NG-AMM-24.pdf
source_pages: [241, 242]
covered_rag_chunk_ids:
  - rag_737ng_amm_24_p241_c03
```

The resolver should not treat those fields as Markdown links.

## Validation Rules

The deterministic link linter should fail when:

```text
An internal Markdown link is absolute.
An internal Markdown link uses a URL scheme.
An internal Markdown link points outside the OKF root.
An internal Markdown link points to a missing file.
An internal Markdown link uses a non-.md target.
A relation target violates the same path rules.
A relation target points to a missing OKF file.
```

The linter should ignore:

```text
Plain text URLs in body content.
Source filenames in source metadata.
RAG chunk IDs.
Document IDs.
Image links, unless an asset policy is added later.
```

## Agent Rules

Agents should not guess link targets. If a link cannot be resolved deterministically, the agent must treat it as missing evidence and the validator should block any claim that depends on that link.

Graph traversal may use only resolved links and typed relations. Unresolved or unsupported link syntax cannot contribute to retrieval confidence, authority, or validation.

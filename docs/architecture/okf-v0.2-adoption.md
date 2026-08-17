# OKF v0.2 Adoption

## Decision

The Google Cloud Platform Knowledge Catalog
[Open Knowledge Format v0.2 specification](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/fe3268a70e8ca5110a43a8f1dfdf6d1a458cf79f/okf/SPEC.md)
is the normative portability contract for AV-OKF bundles.

AV-OKF runs a v0.2-only runtime. The backed-up production migration completed
on 2026-08-06, and every active bundle now declares v0.2 in both its database
row and root index. Production does not maintain dual-read support for v0.1.

## Where The Specification Applies

OKF v0.2 governs the portable filesystem representation:

- bundle directories and nested Markdown concepts;
- `index.md` and `log.md` reserved-file behavior;
- YAML frontmatter parsing and unknown-field preservation;
- the required `type` field and recommended `title`, `description`, `resource`,
  and `tags` fields;
- standard Markdown links between concepts;
- `sources` provenance and claim-level source footnotes;
- `generated` and `verified` authorship and verification events;
- `status` and `stale_after` lifecycle signals;
- actor identifiers and optional attested-computation contracts;
- bundle validation, export, import, and round-trip behavior.

The specification makes the root `index.md` and its `okf_version` declaration
optional. AV-OKF production bundles deliberately require both and fail closed
without them. Generic consumers must tolerate unknown concept types, including
descriptive multiword types, unknown extension fields, missing optional
metadata, and broken links as required by the specification.

## Compatibility Corpus And Validation Layers

Phase 2 pins all four upstream sample bundles at commit
`fe3268a70e8ca5110a43a8f1dfdf6d1a458cf79f` as an offline, Apache-2.0 test
corpus. The corpus contains 79 bundle files: 78 Markdown files and one inert
attester resource. Generated viewers are excluded, every included file is
SHA-256 fingerprinted, and fixture line endings are fixed to LF.

Compatibility is reported as three separate states:

1. **Portable-compatible:** every non-reserved concept has parseable
   frontmatter and a non-empty `type`; reserved indexes and logs follow the
   generic v0.2 rules.
2. **AV runtime-ready:** portable validation passes and the stricter root
   version, relation, source-reference, lifecycle, and profile checks pass.
3. **Agent-ready:** the concept also has active AV-OKF lifecycle, approval,
   content, source-page, and workspace mappings.

The pinned upstream bundles pass portable validation and deterministic semantic
round trips. They are intentionally not runtime-ready because their root
indexes omit the optional version declaration, and none is agent-ready because
the fixtures have no AV-OKF database or source-page projection. The committed
result is [the upstream compatibility report](../debug/okf-v02-upstream-compatibility.json).

`validatePortableOkfV02BundleRoot` implements generic bundle conformance.
`validateOkfV02BundleRoot` builds on it and retains the production-only gates.
Neither validator executes or fetches a resource referenced by a bundle.

## Where AV-OKF Adds Policy

The specification intentionally does not prescribe a database, retrieval
engine, authorization model, review workflow, or agent runtime. AV-OKF keeps
those concerns in the application layer:

- workspace and bundle isolation;
- PDF storage, extraction, raw RAG, embeddings, and worker jobs;
- human and automated approval workflows;
- evidence sufficiency, routing, answer validation, and citation UI;
- typed relation vocabulary and graph preflight;
- source page ranges and PDF drilldown;
- archive, retraction, deletion, and supersession workflows;
- approval provenance and trust-card presentation.

An OKF-conformant concept is not automatically trusted agent evidence. AV-OKF
continues to require an active lifecycle, approved provenance, usable content,
and resolvable source evidence before displaying an approved evidence card.

## Field Mapping

| Current AV-OKF concern | OKF v0.2 representation | AV-OKF behavior |
| --- | --- | --- |
| Content authoring | `generated.by`, `generated.at` | Preserve provider/model or human actor. |
| Human approval | `verified: { by: human:<id>, at: ... }` | Highest approved trust tier. |
| Automated approval | `verified: { by: process:<id>, at: ... }` | Answer-eligible but visibly below human review. |
| Source document | `sources[].resource`, `title`, and credibility signals | Keep page ranges and source identity as extensions until a portable page-fragment convention is adopted. |
| Current lifecycle | `status: stable` | AV-OKF retrieval also applies its active lifecycle projection. |
| Draft content | `status: draft` | Never approved evidence. |
| Historical content | `status: deprecated` | AV-OKF retains the more precise archived, retracted, and superseded reasons as extensions/projections. |
| Typed relations | Standard Markdown links | Preserve typed relation metadata as an extension and expose a normal link so generic consumers can traverse it. |
| `updated` | `generated.at` | Stop generating `updated` during the v0.2 cutover. |
| `source_manifest.md` | Ordinary concept if retained | It is not a v0.2 reserved filename; generic consumers must not need special handling for it. |

Generated v0.2 files do not contain `review_status`, `source_file`, `approved_by`,
`approved_at`, or `updated`. `source_pages`, approval mode, typed relations, and
richer lifecycle fields remain additive AV-OKF extensions; they never replace
the corresponding standard v0.2 families.

## Implemented Cutover Controls

- `pnpm --dir apps/web migrate:okf-v0.2` performs a read-only dry run and writes
  deterministic JSON and Markdown reports under `docs/debug/`.
- Apply requires `--apply --confirm OKF-V0.2-CUTOVER --database-backup <path>`.
- Every bundle is generated under a sibling staging root and passes the internal
  v0.2 validator before any live directory is renamed.
- The complete vault is copied to a timestamped sibling backup. Database failure
  after directory activation restores the original directories.
- Activation creates a new immutable profile version, records document hashes,
  marks the bundle v0.2, and removes stale semantic lookup rows for worker
  reconciliation.
- `source_manifest.md` and prior log text are retained in a deprecated migration
  history concept; portable source-reference concepts replace manifest entries.

## Agent And Import Rules

The agent reads live bundle files, but AV-OKF trust policy remains stricter than
base OKF conformance. `verified` supplies portable trust evidence; workspace
authorization, lifecycle projections, source resolution, and deterministic
answer validation decide whether that evidence is usable in this application.

Imports are untrusted until validated. An imported v0.2 bundle may be shown in
the human explorer after structural validation, but external verification does
not automatically become target-workspace approval. Source-linked reviewed
import requires source mapping and explicit authorization before agent use.

## Cutover Requirements

1. Update the shared parser and typed helpers for every v0.2 family while
   preserving unknown keys.
2. Update exporter, profile manifest, index/log generators, explorer,
   retriever, graph tooling, and validators together.
3. Map existing provenance, approval, lifecycle, and relations without losing
   source pages or approval mode.
4. Back up and dry-run migrate every active bundle.
5. Validate all migrated bundles before atomically switching production reads
   and writes.
6. Remove v0.1 production reads after activation.
7. Build portable archive import only against the stable v0.2 contract.

## Non-Goals

- The specification does not replace Postgres, MinIO, Redis, RAG, or pgvector.
- It does not make free model-directed agent behavior authoritative.
- It does not make every structurally valid concept approved knowledge.
- Attested computations are supported by the format but are not required for
  the initial migration of narrative document knowledge.

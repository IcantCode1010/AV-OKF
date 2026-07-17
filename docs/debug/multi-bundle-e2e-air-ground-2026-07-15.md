# Multi-Bundle End-to-End Test: 13 Air Ground

Date: 2026-07-15  
Environment: Docker Compose production stack, `main` branch  
Result: Pipeline operational with two bundle-conformance blockers and two quality findings

## Test Input

- Source: `C:\Users\ellis\OneDrive\Desktop\Aircraft files\737\13 Air Ground.pdf`
- Size: 3,359,748 bytes
- Selected bundle: General Knowledge
- Document ID: `doc_908dd905-824f-4b8a-953b-7008046c2a52`
- Bundle ID: `kb_eb61c05f8f1b274e1b065f3287b56769`
- Workspace ID: `cmr2lf3s0000101suuz8cz5mn`

## End-to-End Results

| Step | Result | Evidence |
| --- | --- | --- |
| Production health | Pass | Web, worker, Postgres, Redis, and MinIO healthy; `/api/health` returned 200. |
| Authentication | Pass | NextAuth test credentials opened the authenticated document library. |
| Bundle selection | Pass | Upload form required and accepted General Knowledge. |
| PDF upload | Pass | Deployed multipart Server Action redirected to the new document detail route. |
| Object storage | Pass | MinIO stored 3,359,748 bytes under an opaque workspace/document/UUID key. |
| Extraction | Pass | Worker completed extraction; document became `ready` with 29 page records. |
| RAG indexing | Pass | Worker completed indexing; eight active raw-extraction chunks were stored. |
| Topic generation | Pass with quality finding | Deployed Server Action generated 28 `needs_review` topics. |
| LLM enrichment | Pass | OpenAI `gpt-4o-mini` completed enrichment and wrote a successful audit row containing prompt and response lengths. |
| Human approval | Pass | Enriched content was explicitly selected; topic became `approved` and locked. |
| OKF export | Pass with conformance blockers | Export created a collision-safe file and updated the topic projection. |
| Knowledge explorer | Pass | Bundle library and explorer rendered the concept as approved/agent-ready without an application error. |
| Relation discovery | Pass | Discovery completed and correctly returned zero candidates for the available deterministic signals. |
| Approved OKF chat | Pass | Router selected `okf_only`; answer used one direct OKF citation from page 1 and rendered the high-trust Approved OKF evidence profile. |
| Raw RAG fallback chat | Pass with retrieval-noise finding | OKF miss fell back to raw RAG and produced a cited, medium-trust answer. |
| Restart persistence | Pass | After restarting web and worker, document, pages, chunks, topics, export, chat, and health remained available. |
| Relation lint | Pass | Zero typed-relation violations. |
| Bundle-local okflint | Fail | The migrated bundle has no local manifest; a temporary Generic manifest then exposed unsupported AV-OKF extension fields. |

## Completed Result

- Approved topic ID: `cmrmlxb8100j001pcw9d12xiw`
- Approved title: `AIR/GROUND - POSITION INDICATING & WARNING`
- Approved content source: `enriched`
- Exported file: `concepts/system-topic/system-topic-air-ground-position-indicating-warning-e9b38a0500.md`
- Chat session: `cmrmm19f000k401pc9zol16uv`
- Approved OKF answer: `The document describes the AIR/GROUND position indicating and warning systems for the Boeing 737 [1].`
- Raw RAG answer: `The PSEU BITE instruction placard includes information on self-test, sensor rigging aid, landing gear transfer valve test, instructions, air/ground override, and a BITE menu tree [1].`

## Findings

### E2E-001: Migrated bundle lacks `okf-base.yaml` (blocking)

The General Knowledge bundle contains reserved files and concept files but no bundle-local `okf-base.yaml`. The bundle is therefore not independently portable or directly validatable as required by the multi-bundle design. Existing migrated bundles need deterministic scaffolding, not only newly created bundles.

### E2E-002: Generic profile rejects AV-OKF extension fields (blocking)

When the same Generic profile manifest was generated into a temporary test copy, `okflint` reported unknown fields including `covered_rag_chunk_ids`, `coverage_type`, and legacy aviation metadata. The profile builder must include the standard AV-OKF trust/provenance fields as optional extensions for applicable concept types. Aviation-specific fields should remain optional in Generic bundles, not forbidden.

### E2E-003: General Knowledge permits cross-domain RAG noise

The PSEU query returned five relevant Air/Ground chunks plus one irrelevant Forklift chunk because both documents belong to General Knowledge. The answer did not use the irrelevant chunk, but retrieval still spent context on it. Domain-specific bundles or stronger document/entity filtering will improve precision.

### E2E-004: Topic extraction remains page-heavy

The 29-page training document generated 28 topics. Most page headings were useful, but at least two medium-confidence titles were sentence fragments (`well contains...` and `sends air/ground signals...`). The current review gate prevented these drafts from becoming trusted evidence, but topic-boundary quality should be evaluated before bulk approval.

## Log Notes

The real upload, extraction, indexing, enrichment, approval, export, explorer, relation-discovery, and chat requests completed without runtime exceptions. Two `chat_message_required` errors in the web log came from malformed protocol requests while calibrating the headless Server Action harness; React's own `encodeReply` path then completed both real chat turns successfully.

## Verification Boundary

The in-app browser control bridge was unavailable, so this run exercised deployed HTTP forms and Server Actions and verified rendered HTML, persistence, queues, storage, and database state. It did not visually verify animation, responsive layout, graph canvas pixels, or manual click ergonomics.

## Recommended Next Fix

Fix E2E-001 and E2E-002 together: ensure every active migrated bundle is scaffolded with its active profile manifest, and make the Generic profile allow the documented AV-OKF extension fields. Then rerun `okflint validate --vault` against the real mounted workspace vault before testing additional documents.

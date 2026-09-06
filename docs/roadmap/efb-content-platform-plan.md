# Aircraft article pipeline: review and delivery plan

Date: 2026-09-05
Status: local implementation checkpoint; see the current delivery notes below. Historical review findings follow.

## Local delivery checkpoint — 2026-09-06

The additive shared schema and idempotent legacy import are applied locally. Document processing now stops at topic proposals under the shared flag. Chat and Topic builder use a shared bounded research service; articles, source visuals, controlled editable diagrams, manual approval, explicit EFB selection and signed selected-package export are connected.

The restored backup and repeated import retained the original two documents, 226 topics and 37 conversations; 230 shared revision snapshots were imported without replacing legacy history. New testing conversations are additional records.

Verified checks include the production build, regression suite, live multi-document chat, scope cancellation, graph traversal, source invalidation, immutable visual replacement, and signed fixture export through the existing EFB validator. Twenty synthetic research cases and five synthetic article briefs provide a repeatable development evaluation, not aviation-domain acceptance.

Remaining release work: review the evaluation set against real complementary aviation sources, demonstrate the complete retained-library workflow, configure a publisher signing identity, and finish operational/load/device acceptance. Legacy write paths still use compatibility mirroring; removal is deferred until migration verification. The common job-progress contract does not yet replace every legacy queue result. Research deadlines cover research, not the entire legacy chat routing and final-answer sequence.

See [workflow guide](../user-guides/shared-knowledge-workflow.md), [model policy](../architecture/shared-knowledge-model-policy.md), and [recovery instructions](../architecture/shared-knowledge-recovery.md). This release exports artifacts only; it does not activate EFB content.

## Purpose

Turn an existing document library into clear, illustrated aircraft technical articles for aviation enthusiasts, then publish reviewed OKF bundles to the EFB app and its authorized agent. Editorial approval means approval for this educational product, not certification as an operational procedure. Keep source authority, configuration and attribution visible without making the article read like a compliance report.

**Pinned decision: adopt agentic graph RAG for topic research.** Combine existing keyword/vector retrieval, document structure, source-backed entities and typed relationships with a bounded research agent. The agent searches, reads surrounding passages, follows references, checks conflicting evidence and drafts a lesson. Keep a full-source scan as an explicitly exhaustive mode. Use the existing Vercel AI SDK, PostgreSQL/pgvector, Prisma, MinIO and BullMQ. Do not add another agent framework or graph database.

## Clarified product boundary and shared chat research

AV-OKF remains an independent document-processing and knowledge platform containing the full authorized document library, extracted knowledge, articles, figures and graph. Completing its own document-to-knowledge workflow takes priority; EFB is a selective downstream publication destination, not the destination of every discovered or approved topic.

Approval within AV-OKF and selection for EFB are separate editorial actions. Only hand-selected topics and explicitly included supporting evidence/assets enter an EFB release. Related topics may be suggested, never silently included. Source updates can flag selected articles for review but do not automatically publish them. Any earlier language below suggesting approval leads directly to EFB publication is superseded by this explicit selection boundary.

**Pinned decision: agentic graph RAG powers the existing AV-OKF chat as well as Topic builder.** Extend the current chat experience rather than create a separate chat application. Both use shared, read-only hybrid-search, source-reading, graph-traversal and figure-discovery services with independently enforced workspace and user-selected document/bundle scope.

Chat uses those tools to interpret questions, investigate follow-up questions, inspect surrounding source passages, and produce conversational explanations with validated citations. It must distinguish raw source evidence, candidate graph relationships and reviewed OKF knowledge; full-library access does not turn unreviewed material into approved knowledge. It may discuss unpublished AV-OKF material when the user is authorized. Chat does not approve, modify or publish content merely by answering a question.

Topic builder uses the same research services to produce persistent article drafts and proposed visuals for editorial review. Chat and authoring have separate run budgets and output contracts; chat should provide responsive progress and cancellation while deeper authoring work can run as a durable job. Preserve existing chat threads, bundle selection, citations and evidence validation during migration.

Acceptance: existing chat can answer a direct question, follow a multi-document relationship, inspect original evidence, explain missing/conflicting information, and cite the inspected passages. Test scope isolation, revoked/deleted evidence, malicious source instructions, cancellation and bounded incomplete-search reporting. Evaluate against the existing retrieval baseline before enabling model-directed research by default. The EFB agent remains restricted to its separately selected, published and authorized catalog.

## Review conclusion

AV-OKF has a useful document-processing foundation and a functioning local text-authoring workflow. It is not yet a complete, unified illustrated-article-to-EFB publishing product. The biggest gap is integration between its older document-driven authoring path and the newer topic-driven builder. Extend the existing platform rather than replace it.

This is a code and local-state review, supported by the recent live Topic builder generation/rewrite checks. It is not a fresh production deployment, security audit, physical-device test, or verification of every legacy feature. Older readiness reports describe historical fixtures and must not be treated as current source metadata.

## Evidence and current state

Local 737-NG bundle snapshot: 2 documents, 926 RAG chunk records, 226 TopicRecord records, 25 relation candidates, zero DocumentMediaAsset records and zero topic/media references. The workspace has 2 Topic builder recipes. Counts do not imply all chunks are current, all embeddings are ready, or all topics/relations are approved.

| Stage | Existing implementation | Gap for the intended product |
| --- | --- | --- |
| Upload and extraction | Private original storage, extraction jobs, page-preserving text, selective OCR, resumable processing | Surface source identity, extraction completeness, table/visual quality and usable coverage together before research |
| Source retrieval | PostgreSQL keyword/vector retrieval, rank fusion, chunk context, index jobs and checkpoints | Topic builder bypasses this and scans every section; inventory active index/embedding readiness before reuse |
| Knowledge graph | Entity occurrences/aliases, relation candidates, verification and reviewed OKF relation traversal | Candidate graph is not equivalent to trusted relationships; connect research to both with explicit provenance/status |
| Article generation | Document-driven TopicRecords plus separate TopicBuilderRecipe/Run/Scan models; instructor policy and bounded rewriting in the latter | Two authoring/review paths and inconsistent capabilities; one shared article-revision contract is needed |
| Visual discovery | Page-image analysis, figure crops, OCR labels, source metadata, topic associations and review states | Existing figure associations target TopicRecords; Topic builder is text-only and has no figure selection or visual review |
| Local OKF export | Older exporter includes media metadata and figure Markdown; Topic builder exports native text, evidence and graph ZIP | Topic builder approval does not populate the older knowledge vault or its EFB automation |
| EFB release | Immutable exporter and PoC package jobs exist; explicit supporting-asset capability exists in exporter | Automatic PoC job does not pass supporting assets; Topic builder does not call this release boundary |
| EFB consumption | Authorized article reads, related links, asset validation/download and withdrawal-aware access exist | Need integrated authorized inline figures/zoom and full illustrated-package verification; source tool currently exposes asset metadata, not interpreted visual content |
| Updates/removal | Existing deletion/lifecycle mechanisms and Topic builder source-fingerprint checks | Add dependencies from changed passages/figures to derived articles and publication state; end-to-end refresh/withdrawal needs proof |

Code anchors: `apps/web/src/lib/{knowledge-authoring,large-pdf-extraction,rag-repository,rag-retrieval,topic-media-discovery,topic-enrichment,okf-export,okf-relations,topic-builder,topic-builder-core,efb-release-automation,efb-release-export,bundle-workflow}.ts` and `apps/web/prisma/schema.prisma`. EFB anchors: `server/{publication,assets,knowledge}.ts`, `src/pages/CloudKnowledgeArticle.tsx` in `C:/projects/Project-EFB-MX`.

## Target author experience

1. Add or select documents in the source library. Show extraction/index/figure readiness and document applicability.
2. Choose a topic, audience and desired depth. Research identifies supported teaching points and missing sources before a costly full draft.
3. Inspect a proposed article outline and suggested visuals. Make this an editable preview, not a mandatory series of approval interruptions.
4. Generate an instructor-style draft with exact supporting passages and structured relationships. Rewrites reuse unchanged evidence.
5. Select a source figure or request an original educational diagram. Review text and visuals together, with source comparison available.
6. Approve a specific immutable revision. Show approved and published as separate statuses.
7. Publish through the EFB control plane. Display the actual release status and a link to the EFB article; do not call an exported ZIP published.
8. When sources change, show affected articles and proposed differences. Withdrawn sources stop contributing to new outputs; published dependent content follows an explicit review/withdrawal policy.

## Agentic graph RAG design

- Reuse existing passage indexing, keyword/vector search, entity and relation services; measure them before replacing them.
- Maintain original document/page/section identity, content hashes, source authority, revision, aircraft configuration and access scope on evidence.
- Start with document structure and explicit references. Add AI-extracted technical edges as candidates with source passages, relation type, conditions and review status. Do not merge variants or treat similarity as proof of a functional connection.
- Expose read-only search, section reading, neighbor traversal, source/figure reading and enumeration tools. Enforce workspace and selected-source scope in every tool, including counts and graph neighbors.
- Ask several topic-specific research questions, inspect surrounding context and verify edges against original passages. Bound calls, tokens, depth and runtime; report gaps and actual coverage.
- Graph summaries guide discovery; technical claims cite inspected source evidence, not an unsupported generated summary.
- Keep the research library separate from EFB's published catalog. An authoring graph does not grant the EFB user access to unpublished documents.

## Images and diagrams

Use visuals when they explain the article's central idea. Do not require an image on every article or use a visually impressive image as evidence of technical accuracy.

### Source figures first

Reuse the existing figure pipeline. Preserve original page and extraction, caption, figure number, legend, bounding box, resolution, source revision, configuration and hash. Allow the author to inspect all relevant pages and select a crop manually: current candidate heuristics can miss vector-only drawings without recognizable captions. Do not crop away operating conditions or legends. Figure-discovery warnings currently do not block authoring; distinguish “no useful figure” from “visual processing failed.”

Provide exact, cleaned and annotated variants, preserving the original separately. Compare the selected figure with its source and the draft before approval. Tie media to stable article revisions rather than only legacy TopicRecords.

### Original explanatory diagrams

Create simple system/flow diagrams from verified relationships. Author editable SVG or a structured diagram specification, with evidence attached to nodes, arrows, states and labels. A conceptual diagram must be labeled as such and must not imply an exact physical layout. Preserve conditions and variant differences.

EFB currently accepts PDF, PNG, JPEG and WebP supporting assets up to 3 MB and rejects SVG. Keep SVG as the editable authoring master and publish a readable raster derivative initially. Native SVG would need an explicit sanitization/rendering contract and security review; do not simply loosen MIME validation.

### Generated illustrations

Optional AI-generated illustrations can help with an overview or visual orientation. Use source-reference images for aircraft-specific reconstruction; compare geometry, component count, orientation and operating state against them. Add technical labels and arrows separately as editable elements. Label generated/conceptual imagery clearly and fall back to the original or a simple diagram when accuracy cannot be established. Do not invent hidden internal construction. No integrated generation/review path was demonstrated in this review.

Store the original/reference, derivative, generation model/prompt when applicable, caption, alt text, dimensions, source/evidence links, attribution and editorial review in a shared asset record. Publish the asset with the article revision and checksum. Index captions and reviewed visual descriptions for agent discovery; image availability alone does not mean the agent can understand it.

## Delivery order and acceptance gates

1. **Unify the content lifecycle and publication contract.** Both authoring entry points produce the same revision/media/evidence package, preserving existing IDs and drafts. Connect one approved Topic builder article to a staged EFB release, activation, rollback and an authenticated article URL. Approval alone never implies publication.
2. **Ship source figures end to end.** Select a real figure, review its crop/caption, include it in the package, display it inline with zoom on phone/tablet/web, and expose its source to the EFB agent. Test denied access and withdrawal of both article and asset. Retain a meaningful textual equivalent.
3. **Connect agentic graph research.** Reuse the existing indexes and relationships. Compare against full-scan baselines on direct, multi-document, ambiguous, conflicting and missing-evidence topics. Include a source with actual operating theory, not just QRH mentions. Measure technical coverage, condition preservation, cost and latency before making it default. Do not assert a speed or completeness guarantee in advance.
4. **Add editable explanatory diagrams and optional generated illustrations.** Require article/figure consistency, legible labels at phone size, source comparisons and explicit conceptual/generated labels. Publish derivatives through the same asset contract.
5. **Close the source-change loop.** New documents suggest affected topics; edits create reviewed diffs; deletion/withdrawal invalidates retrieval and flags dependencies; old approved revisions remain auditable. Verify the behavior in EFB without redeploying the harness.

First complete demonstration: a supported 737 system topic using two complementary documents, one concise instructor-style article, one source figure and one optional evidence-backed diagram. Approve, publish, read it on a phone/tablet, ask the EFB agent a question with a resolvable citation, add new evidence and publish a revision, then test withdrawal. Existing legacy features alone do not substitute for this end-to-end acceptance test.

## Immediate priorities

Do not expand the page-by-page Topic builder into another independent document platform. Its topic-first experience is useful; its evidence collection, media handling and publication should converge on shared services. Keep source selection, writing depth and editorial control visible, while hiding queue mechanics and internal evidence IDs from article prose. Preserve the current working system during this migration.

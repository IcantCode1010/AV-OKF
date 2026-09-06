# AV-OKF knowledge workflow

AV-OKF holds the document library and knowledge graph. EFB receives only articles deliberately selected for an export. Approving an AV-OKF revision does not select it or publish it to EFB.

## Using the local workflow

1. Upload documents or use documents already in the library. Finish text extraction and search indexing. The document page reports text, tables, search, figures, and graph readiness separately.
2. Review proposed topics under **Articles**, or open **Topic builder** and choose your own topic and source documents or collections. Proposals do not automatically become articles.
3. Choose agentic research or the checkpointed full-document scan. Article lengths remain configurable from 80–500 words. The full scan examines every extracted section; graph research reports retrieved or partial coverage.
4. Open the resulting article in **Articles**. Check its source passages, revise the draft, add a source crop or annotation, or propose an explanatory diagram. Diagrams are conceptual, editable, and require supporting passage references. Visual edits create new versions and retain the original.
5. Review each included visual, then approve that article revision. Editing approved content creates a new draft. Historical source changes are flagged, and affected revisions cannot produce a new export.
6. Select an approved revision for EFB, with aircraft, effectivity, audience, placement, license, and attribution metadata. Review **EFB selections**, then validate and export. Required article dependencies must be selected explicitly. The resulting signed package is downloadable; nothing is activated in EFB.



## Choosing aircraft for an EFB selection

In an approved article, open **Select this revision for EFB**. Choose an aircraft family, then add the applicable aircraft type from the dropdown. Selected types appear below with a Remove action. Changing family clears the previous types so they cannot accidentally carry into another family. Family choice alone does not assert applicability to every variant.

The current connected EFB registry supports Boeing 737-800 under Boeing 737 Next Generation, and Airbus A320neo (A320-251N) under the Airbus A320 family. The form saves EFB application identifiers automatically; these are not necessarily ICAO codes. Additional aircraft must first be supported by the EFB registry and added to the matching AV-OKF catalog. Configuration/effectivity remains a separate source-grounded entry. Server validation rejects unsupported or mismatched family/type combinations; recognized older family labels such as “Boeing 737NG” are normalized.

## Chat and evidence

New conversations select all accessible collections. Existing conversations keep their saved collections. Change scope beside the conversation; the scope request cancels active shared research and prevents the previous scope's answer from being saved. Older messages outside the current scope are excluded from subsequent requests. Legacy cited answers without a complete source snapshot are conservatively excluded from model history.

The research service can search source text, enumerate documents, read page continuations, find topics, follow candidate and native topic links, and discover source figures. Candidate relations and visual metadata are discovery aids. Technical claims require inspected source passages. Greetings and acknowledgements do not invoke retrieval.

New or changed documents do not automatically rewrite approved articles. Refresh the relevant recipe to prepare a new revision. Selecting individual documents preserves that exact source choice; selecting a collection includes its new documents on refresh. Writing-only rebuilds can reuse evidence when source, scope, model, and research-policy versions still match.

## Rollout controls

These server variables are passed through Docker Compose; configure local values in the ignored root `.env`:

| Variable | Controls |
| --- | --- |
| `AV_OKF_SHARED_ENABLED` | Shared article services, source readiness, proposal-first ingestion, all-collection defaults |
| `AV_OKF_CHAT_ENABLED` | Shared agentic chat research and conversational turns |
| `AV_OKF_AUTHORING_ENABLED` | Agentic authoring option; full scan remains available |
| `AV_OKF_EXPORT_ENABLED` | Explicit EFB selection and signed export |
| `AV_OKF_RESEARCH_TOKEN_LIMIT` | Optional stricter combined research input/output-token limit |

Defaults in versioned configuration are off. Automatic PoC exports default to disabled. Apply an additive migration before enabling the shared services. Turn individual flags off and recreate web/worker containers to restore the earlier application path; retain the new tables and immutable revisions.

Research budgets are 12 model steps/24 tools/90 seconds for chat research, and 24 steps/80 tools/10 minutes for authoring research, with two concurrent tools. Tool results and model output also have size limits. Hitting a research limit produces a partial result, not an exhaustive claim. Workspace model settings remain authoritative. Provider token accounting can report the last completed call after a limit is reached; these controls are not a prepaid billing cap.

## Signed exports

Configure `AV_OKF_EFB_SIGNING_KEY_PATH` with a backend-readable Ed25519 private-key path, `AV_OKF_EFB_SIGNING_KEY_ID` with its publisher identity, and `AV_OKF_SOURCE_COMMIT` with the source revision. Keep private keys outside the repository and public downloads. `PROJECT_EFB_ROOT` points to the existing EFB contract checkout. The exporter verifies checksums, the signature, and the EFB contract before exposing a release. It does not register publisher trust or activate a catalog in EFB.

Legacy approval provenance is retained. An imported automatic approval is not silently relabeled as human review for export. Make and manually review a new revision when historical approval provenance is insufficient.

## Verification and remaining release work

The synthetic test suite covers source isolation, exact quotes, idempotent imports, source edits and withdrawals, graph links, annotated PDF derivatives, visual version retention, approved visual immutability, signed selected export, and the existing chat service's greeting/citation/scope-cancellation behavior. Twenty research questions and five briefs exercise complementary fictional documents; each brief is tested with graph research and full scan.

Those fixtures do not establish aviation content quality or large-library performance. Before external release, review a representative real-document evaluation set, finish large-source ingestion/restart and concurrent-load checks, and perform physical phone/tablet review. Keep legacy compatibility paths until their consumer migration is verified. Generated raster illustrations and live EFB activation remain outside this release.

### Processing handoff

Proposal-only processing ends at **Select topics to draft**. Review lists display discovery titles and summaries until enriched versions exist. Article enrichment, article classification and article validation remain deferred until a topic is selected; source processing does not mark articles approved. Earlier proposal-only runs receive the same display treatment.

### Bulk topic enrichment

On the bulk review page choose **Bulk enrichment**, then **Select all for enrichment** or individual topics, and **Enrich selected topics**. This explicitly schedules discovered/failed topics with the existing topic-enrichment writer. The Redis worker processes one topic at a time; accepted, pending and already enriched topics cannot be selected. Refresh the review list to see completed enrichment or failures. Retry failed topics in enrichment mode. Bulk approval remains a separate mode and selecting it clears the enrichment selection. Neither scheduling nor finishing enrichment approves or exports content.

The document-specific **Topics** page and collection-wide review use the same bulk controls and records; the document URL applies a filter. A document with discovered topics and no approval-ready drafts opens in enrichment mode with selectable checkboxes. Full topic review is the detailed single-topic view. The newer Articles screen manages immutable article revisions; it still overlaps with legacy topic review during migration.

### Activity and live progress

The header Activity drawer follows tracked work across navigation: topic enrichment, document processing, extraction, article drafting/research, chat research, bulk approval and selected EFB exports. The topic review page also shows inline enrichment progress. Updates poll every three seconds while work is active and every ten seconds when idle, pause while the tab is hidden, and back off on failures. Completed drafts refresh automatically. Connection loss keeps the last known snapshot visible and shows reconnecting.

Progress reports finished/total and failures, the active topic, elapsed time, and a rough processing-time estimate after three successful topic timings. This uses the median observed duration and excludes additional queue delay; it is not a guaranteed finish time. Recent operations cover 24 hours. Existing database job records preserve enrichment history; retained older Redis jobs are reconciled so an already-started batch can appear. This does not yet cover every small mutation or all background maintenance tasks.

# Front-End UI and Chat E2E - 2026-07-23

## Scope

Production Docker stack at `http://localhost:3000`.

This pass tested existing UI and chat behavior only. It did not upload,
extract, enrich, approve, export, reindex, delete, or otherwise ingest a
document.

Workspace:

- `AV-OKF Test User's Workspace`
- Bundle: `737ng`
- Existing document: `737-qrh`
- Test chat: `cmrxlfwy9000001mlym0hddqt`

## Results

| Area | Result | Evidence |
| --- | --- | --- |
| Shared desktop shell | Pass | At 2000 px, Documents used the full content area beside the 288 px sidebar with no horizontal overflow. |
| Dark select controls | Pass | Document and provider selects used light text on dark backgrounds. |
| Document library | Pass | Existing document row opened without an error. No upload was attempted. |
| Document processing | Pass | The completed extraction and authoring stages rendered, with review/export shown as action required. |
| Document panels | Pass | Processing, Summary, Metadata, Extraction, AI Authoring, Topics, and Logs all rendered existing data. |
| Knowledge library | Pass | The active bundle card and create-bundle form rendered without changing data. |
| Knowledge explorer | Pass | Tree, nonblank graph, reader, concept selection, and relation-discovery status rendered. Selecting a concept updated `?file=`. |
| Mobile explorer | Pass | Tree/Graph/Reader tabs worked at 390 x 844. The selected graph canvas rendered at 374 x 496 with no horizontal overflow. |
| Chat creation | Pass | A new chat was created for the selected `737ng` bundle. |
| Chat pending feedback | Pass | The user message appeared immediately with `Searching the knowledge bundle and raw document evidence`; Send changed to disabled `Sending...`. |
| Approved OKF answer | Pass | `What is the cargo door procedure?` returned a synthesized answer with a Human-approved OKF card and two sources. |
| Evidence expansion | Pass | The card expanded and displayed source title, pages, provenance, file path, and excerpt. |
| Sources and trace | Pass | Route, confidence, answer model, rationale, tools, and sources read were visible. |
| Citation round trip | Pass | Citation 1 opened the approved topic and `Back to conversation` returned to `/chat/cmrxlfwy9000001mlym0hddqt`, not the conversation list. |
| Unsupported answer | Pass | A live-weather question returned the unsupported template, no citations, and a No evidence card. |
| Mobile chat | Pass | Chat, evidence card, fixed composer, and Sources & trace drawer fit without horizontal overflow. |
| Browser console | Pass | No warnings or errors were captured during the UI flow. |
| Backend logs | Pass with warning | No request failures or exceptions. Node emitted the existing `url.parse()` deprecation warning. |

## Chat Workflow Observed

```text
New chat
  -> choose bundle
  -> send question
  -> user message appears immediately
  -> searching/sending state is visible
  -> router selects OKF
  -> approved evidence is retrieved
  -> LLM synthesizes the answer
  -> evidence card and trace render
  -> citation opens approved topic
  -> Back to conversation returns to the same session
```

## UX Follow-Ups

1. **Outdated stage copy**
   - Dashboard/Documents still describe a Stage 1 shell and say extraction
     does not exist.
   - Settings says the configured key is for "future topic enrichment" and
     describes real auth/roles as deferred.
   - These statements no longer match the implemented product.

2. **Conversation naming**
   - Existing cards and the new test session are all titled `New chat`.
   - Derive a useful title from the first user question or allow rename.

3. **Duplicate headings in evidence excerpts**
   - Expanded evidence showed content such as:
     `# Cargo Door Procedures # Cargo Door Procedures ## Overview`.
   - The dedicated approved-topic page renders a clean article, so excerpt
     construction should remove repeated title headings before display.

4. **Reserved-file reader labeling**
   - Selecting `index.md` displays `Untitled` with `unknown` metadata badges.
   - Reserved files should use their filename or a reserved-file label and
     suppress concept-only metadata.

5. **Runtime deprecation warning**
   - The web container logs Node's `DEP0169` warning for `url.parse()`.
   - Trace the dependency or call site and migrate to the WHATWG URL API when
     practical.

## Conclusion

The tested front-end flow is operational. No blocker was found in navigation,
chat pending feedback, approved evidence presentation, unsupported handling,
mobile layout, or citation return navigation. The remaining issues are
presentation and copy consistency improvements.

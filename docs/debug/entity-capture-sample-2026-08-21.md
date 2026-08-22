# Real Entity Capture Sample: 737ng

This report records actual configured-provider output produced by the running
AV-OKF Docker stack after deploying the entity graph migration. It is not a
synthetic example.

## Source Bundle And Topic

- Bundle: `737ng`
- Source document: `29 Lights`
- Approved OKF concept: `Attendant Control Panel Functions`
- Exported file: `concepts/system-topic/system-topic-attendant-control-panel-functions-b700532394.md`
- Approved concept source pages: 33, 35, and 36
- Approval mode: `human_bulk`

## Captured Entity

```yaml
canonical_name: Attendant Control Panel
entity_type: system
registry_status: provisional
bundle: 737ng
source_document: 29 Lights
source_topic: Attendant Control Panel Functions
source_pages: [34, 35, 36, 37]
evidence_quote: "The attendant control panel (ACP) has an LCD touchscreen"
aliases:
  - value: Attendant Control Panel
    status: accepted
  - value: ACP
    status: needs_review
classification:
  ata_chapter: "737 NG 33-21-00"
```

This entity remains structural registry data. It is not an independently
approved OKF concept and cannot be cited or traversed by the agent as trusted
evidence.

## Actual Approved OKF Source

The exported concept is a stable `system_topic` verified by a human bulk
approval. Its article states that the ACP has an LCD touchscreen and describes
lighting control, passenger services, environment status, and maintenance
functions. The entity record links back to this concept and its grounded RAG
chunks; it does not duplicate the article into a second Markdown file.

## Quality Findings

The first live sample proves that extraction, source grounding, persistence,
aliases, classifications, and the Entity map are operational. It also exposes
precision problems that must be fixed before entity data influences retrieval:

- `Attendant Control Panel` is a useful system entity.
- `ACP` is correctly held for alias review rather than accepted automatically.
- `Boeing 737 Maintenance Training Student Book` was incorrectly classified as
  a product and auto-registered after appearing in two documents. This is
  document boilerplate, not a useful operational entity.
- `Airbus` appeared as a provisional organization in the `737ng` bundle and
  requires source inspection before acceptance.
- `conductive coating` was classified as a system; this likely needs a material
  type or should remain an unpromoted candidate.

Recommended next tuning: add document-title/producer boilerplate suppression,
profile-aware entity-type definitions, and an entity usefulness filter before
canonical registration. Keep all current entities non-authoritative until that
evaluation is complete.


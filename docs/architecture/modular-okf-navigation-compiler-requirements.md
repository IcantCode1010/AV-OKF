# Modular OKF Navigation Compiler Requirements

## Purpose

Create a reusable navigation-compilation module that adds roots, subsystem hubs, article membership, and valid relationships to EFB knowledge packages.

The module must support:

- Different ATA chapters
- Different aircraft families
- Pilot and maintenance content
- Different document bundles
- Multiple immutable package versions
- Future non-aviation OKF packages where applicable

ATA Chapter 27 is the first configuration and acceptance fixture. It must not be hard-coded into the general compiler.

## Target Process

```text
Approved OKF articles
    ↓
Select navigation profile
    ↓
Assign articles to hubs
    ↓
Generate root and hub pages
    ↓
Generate navigation links
    ↓
Include approved technical relations
    ↓
Validate complete wiki graph
    ↓
Compile new immutable package version
    ↓
Publish through Project EFB's existing receiver
```

The package publisher must consume the compiled navigation result. It must not contain ATA-specific organization logic.

---

# 1. Navigation Profiles

## Requirement

Do not hard-code ATA 27 logic into the exporter or publisher. Define a version-controlled navigation profile for each knowledge set.

Example ATA 27 profile:

```yaml
profile_id: 737-flight-controls
profile_version: 1

placement:
  kind: ata
  target_id: "27"

root:
  entry_id: ata-27-flight-controls
  title: ATA 27 — Flight Controls
  type: index

hubs:
  - entry_id: ata-27-general
    title: General and Hydraulic Interfaces
    match:
      topic_group: general

  - entry_id: ata-27-ailerons
    title: Aileron Control
    match:
      topic_group: aileron

  - entry_id: ata-27-flight-spoilers
    title: Flight Spoilers
    match:
      topic_group: flight-spoiler

  - entry_id: ata-27-speedbrakes
    title: Speedbrake and Ground Spoilers
    match:
      topic_group: speedbrake

  - entry_id: ata-27-elevator
    title: Elevator Control
    match:
      topic_group: elevator

  - entry_id: ata-27-stabilizer-trim
    title: Stabilizer Trim
    match:
      topic_group: stabilizer-trim

  - entry_id: ata-27-rudder
    title: Rudder Control
    match:
      topic_group: rudder

  - entry_id: ata-27-trailing-edge-flaps
    title: Trailing-Edge Flaps
    match:
      topic_group: trailing-edge-flaps

  - entry_id: ata-27-leading-edge-devices
    title: Leading-Edge Flaps and Slats
    match:
      topic_group: leading-edge-devices
```

Future packages must supply different profiles while using the same compiler.

## Profile Requirements

Each profile must define:

- Stable profile ID
- Profile version
- Placement kind and target
- One root node
- Zero or more hub nodes
- Article-to-hub classification rules
- Display-order rules
- Allowed standalone-article behavior
- Applicable OKF object types

## Versioning Rules

- Profiles are committed to Git.
- Existing profile versions are immutable after publication.
- Profile changes require a new profile version.
- A changed profile produces a new immutable package version.
- Compiled packages record the exact profile and compiler versions used.

---

# 2. Compiler Modules

Implement independent modules rather than a single ATA-specific function.

```text
navigation/
├── profile-schema.ts
├── load-profile.ts
├── classify-membership.ts
├── generate-root.ts
├── generate-hubs.ts
├── generate-navigation-links.ts
├── compile-relations.ts
├── validate-graph.ts
└── report-navigation.ts
```

## Module Responsibilities

### `profile-schema.ts`

- Validate profile structure.
- Reject missing roots, duplicate hub IDs, invalid types, and invalid placements.

### `load-profile.ts`

- Load a named profile and version.
- Return a normalized, immutable configuration object.

### `classify-membership.ts`

- Assign each included article to one root or hub.
- Preserve the classification method and confidence.
- Reject unexplained unassigned articles.

### `generate-root.ts`

- Generate the package root page.
- Link the root to its hubs and intentional standalone children.

### `generate-hubs.ts`

- Generate one page for each configured hub.
- Link each hub to its assigned articles in deterministic order.

### `generate-navigation-links.ts`

- Generate ordinary portable Markdown links.
- Follow the existing OKF link-resolution rules.
- Use relative `.md` targets for internal links.

### `compile-relations.ts`

- Emit only relation types allowed by `okf-base.yaml`.
- Keep structural navigation separate from technical relationships.
- Preserve relation reason and target type.

### `validate-graph.ts`

- Resolve all links and typed relations.
- Verify root-to-article reachability.
- Detect broken links, orphans, duplicates, cycles, and invalid target types.

### `report-navigation.ts`

- Produce machine-readable and human-readable summaries.
- Report root, hub, article, navigation-edge, and technical-relation counts separately.

---

# 3. Use the Existing OKF Relationship Vocabulary

The controlled relation vocabulary already exists in `okf-base.yaml`. Do not add unsupported `contains`, `parent`, or generic `related` relations solely for EFB navigation.

## Structural Membership

Use `part_of` from an article to its hub:

```yaml
relations:
  - relation: part_of
    target: ../indexes/ata-27-trailing-edge-flaps.md
    target_type: index
    reason: This article is part of the ATA 27 trailing-edge flap subsystem.
```

The hub page must also provide normal Markdown navigation links:

```md
# Trailing-Edge Flaps

- [System Operation](../topics/trailing-edge-flap-operation.md)
- [Hydraulic Operation](../topics/trailing-edge-flap-hydraulics.md)
- [Flap Skew Detection](../topics/flap-skew-detection.md)
```

The receiving application can derive incoming parent links and backlinks. Do not generate redundant reverse typed relations unless the OKF model explicitly requires them.

## Contextual Relationships

Use an existing relationship such as `references` only when the article content or approved metadata supports the connection:

```yaml
relations:
  - relation: references
    target: flap-skew-sensors.md
    target_type: system_topic
    reason: Skew detection receives position information from these sensors.
```

## Relationship Rules

- Structural classification may generate `part_of` deterministically.
- Technical, contextual, operational, and safety relationships require source-supported or approved relation metadata.
- Do not invent semantic relationships to increase graph density.
- Every typed relation must include a valid target, target type, and reason.
- Every target must resolve through the existing OKF link resolver.
- The declared target type must match the target file's actual type.

---

# 4. Separate the Two Graphs

## Navigation Graph

```text
Root → subsystem hubs → technical articles
```

The navigation graph is generated deterministically from the selected profile and approved article classifications.

Every included article must participate in this graph.

## Technical Graph

```text
Sensor → controller → valve → actuator
```

The technical graph is generated only from approved, source-supported OKF relations.

An article does not need numerous technical relations to be valid. It does need a valid place in the navigation graph.

---

# 5. Reusable Article Classification

Each article must receive a navigation classification before package compilation.

Example:

```json
{
  "navigationProfileId": "737-flight-controls",
  "navigationProfileVersion": 1,
  "rootEntryId": "ata-27-flight-controls",
  "hubEntryId": "ata-27-trailing-edge-flaps",
  "displayOrder": 1420,
  "classificationMethod": "approved-metadata",
  "confidence": 1
}
```

## Classification Priority

Use evidence in this order:

1. Explicit approved hub assignment
2. Existing topic or source-section hierarchy
3. Existing structured article classification
4. Deterministic rules from the selected profile
5. Manual assignment

Do not classify articles from title keywords alone when stronger structured information exists.

## Unassigned Articles

An unassigned article must either:

- Fail package compilation, or
- Be explicitly approved as a standalone child of the root

The compiler must never silently drop an article.

---

# 6. Package Metadata

Record navigation provenance in the immutable package:

```json
{
  "navigation": {
    "compilerVersion": "1.0.0",
    "profileId": "737-flight-controls",
    "profileVersion": 1,
    "rootEntryId": "ata-27-flight-controls",
    "hubCount": 9,
    "technicalArticleCount": 79
  }
}
```

The package must distinguish:

- Root count
- Hub count
- Technical-article count
- Navigation-edge count
- Technical-relation count

Root and hub pages must not be included in the count of 79 existing technical articles.

---

# 7. General Validation Gates

Every package must pass the following checks.

## Profile Validation

- [ ] Profile ID and version are present.
- [ ] Exactly one root is declared.
- [ ] Root and hub IDs are unique.
- [ ] Placement kind and target are valid.
- [ ] Classification rules are deterministic.

## Navigation Validation

- [ ] The declared root exists.
- [ ] Every declared hub is reachable from the root.
- [ ] Every included article belongs to a root or hub.
- [ ] Every included article is reachable from the root.
- [ ] No unexplained orphan articles exist.
- [ ] No invalid root or hub membership cycles exist.
- [ ] Display ordering is deterministic.

## Link and Relation Validation

- [ ] Every Markdown link resolves.
- [ ] Every typed relation resolves.
- [ ] Every relation uses the `okf-base.yaml` vocabulary.
- [ ] Every `target_type` matches the actual target.
- [ ] No duplicate stable IDs exist.
- [ ] Cross-package references are version-qualified and resolvable when required.

## Package Validation

- [ ] All article representations exist.
- [ ] Identity and metadata agree across representations.
- [ ] Checksums match.
- [ ] Navigation metadata records the compiler and profile versions.
- [ ] A new compilation produces a new immutable package version.

## Example Report

```json
{
  "profileId": "737-flight-controls",
  "profileVersion": 1,
  "rootCount": 1,
  "hubCount": 9,
  "technicalArticleCount": 79,
  "reachableTechnicalArticleCount": 79,
  "navigationEdgeCount": 88,
  "technicalRelationCount": 0,
  "brokenLinks": [],
  "orphans": [],
  "result": "pass"
}
```

The example assumes 1 root, 9 hubs, and 79 existing technical articles. All generated edge and technical-relation counts must be calculated from the actual package.

---

# 8. Modularity Tests

Prove that the implementation is not specific to ATA 27.

## Required Fixtures

### Fixture 1 — ATA 27

- One ATA 27 root
- Nine configured subsystem hubs
- The current 79 technical articles
- Maintenance placement

### Fixture 2 — Another ATA Chapter

Create a small mock ATA 29 or other maintenance package with:

- A different placement target
- A different root
- Different hubs
- A small set of technical articles

### Fixture 3 — Pilot or QRH

Create a small mock package with:

- A non-ATA placement
- A different root type and target
- A different hub layout

All fixtures must pass through the same compiler modules.

## Prohibited Implementation

Do not add chapter-specific logic such as:

```ts
if (ataChapter === "27") {
  // Special package construction
}
```

The selected profile and article metadata must control compilation.

---

# 9. Publisher Boundary

The navigation compiler and publisher have separate responsibilities.

## Navigation Compiler

- Selects and validates a profile.
- Classifies article membership.
- Generates the root and hubs.
- Generates portable Markdown navigation links.
- Emits allowed typed relations.
- Validates graph reachability.
- Produces an immutable compiled package.

## Publisher

- Accepts an already compiled and validated package.
- Validates its transport structure and checksum.
- Uploads it through Project EFB's existing receiver contract.
- Imports into the existing EFB Supabase tables.
- Activates it through the existing EFB publication RPC.

The publisher must not:

- Reclassify article membership.
- Generate missing relationships.
- Modify the compiled package.
- Create a parallel Supabase schema.
- Replace Project EFB's existing catalog-activation model.

---

# 10. Version-Control Requirements

Commit to Git:

- Navigation profile schema
- Versioned navigation profiles
- Compiler modules
- Graph validator
- Test fixtures
- Compiler tests
- Package metadata schema changes
- Developer documentation

Do not modify an existing published package. Every change to content, navigation, profile assignment, hub structure, or relationships must produce a new immutable package version.

The package must record:

```text
source Git commit
compiler version
navigation profile ID
navigation profile version
package ID
package version
package checksum
```

---

# Implementation Phases

## Phase A — Profile Contract

- [ ] Define the profile schema.
- [ ] Create the ATA 27 profile.
- [ ] Validate profile IDs, roots, hubs, and placement data.
- [ ] Document profile versioning.

### Exit Gate

The ATA 27 hierarchy is represented entirely as configuration.

## Phase B — Root and Hub Generation

- [ ] Generate a root page from the profile.
- [ ] Generate configured hub pages.
- [ ] Generate deterministic Markdown child links.
- [ ] Preserve stable root and hub IDs.

### Exit Gate

The compiler produces one ATA 27 root and nine hub pages without hard-coded chapter logic.

## Phase C — Article Membership

- [ ] Add structured navigation classification to each article.
- [ ] Implement classification priority.
- [ ] Reject unexplained unassigned articles.
- [ ] Generate structural `part_of` relations.

### Exit Gate

All 79 technical articles have one valid root or hub path.

## Phase D — Technical Relationships

- [ ] Preserve approved existing OKF relations.
- [ ] Generate no unsupported semantic relationships.
- [ ] Validate relation reasons and target types.
- [ ] Add ordinary Markdown links for portable traversal.

### Exit Gate

Every exported technical relation is allowed, resolved, and supported.

## Phase E — Graph Validation

- [ ] Validate the root and hubs.
- [ ] Validate all Markdown and typed-relation targets.
- [ ] Validate root-to-article reachability.
- [ ] Detect orphans, duplicates, and invalid cycles.
- [ ] Generate the navigation report.

### Exit Gate

The ATA 27 package reports 79 of 79 technical articles reachable with no broken links or orphans.

## Phase F — Package Integration

- [ ] Add navigation provenance to the manifest or approved extension.
- [ ] Count roots, hubs, and technical articles separately.
- [ ] Generate a new immutable package version.
- [ ] Run the existing Project EFB structural validator.

### Exit Gate

The new navigable package passes both OKF graph validation and Project EFB package validation.

## Phase G — Modularity Proof

- [ ] Add the ATA 27 fixture.
- [ ] Add a second ATA chapter fixture.
- [ ] Add a pilot or QRH fixture.
- [ ] Run all fixtures through the same compiler.
- [ ] Confirm no ATA 27 conditional logic exists in shared modules.

### Exit Gate

All fixtures compile and validate using configuration rather than chapter-specific code.

---

# Definition of Done

- [ ] Navigation behavior is profile-driven.
- [ ] ATA 27 is a configuration, not a compiler special case.
- [ ] The current package contains one root and nine hubs.
- [ ] All 79 technical articles are reachable.
- [ ] Structural membership uses the existing `part_of` relation.
- [ ] Portable Markdown links are present.
- [ ] Technical relations are source-supported and use the controlled vocabulary.
- [ ] Link and target-type validation is deterministic.
- [ ] Compiler and profile versions are recorded.
- [ ] New navigation produces a new immutable package version.
- [ ] At least three distinct profile fixtures pass.
- [ ] The publisher consumes the compiled result without reorganizing it.
- [ ] Project EFB's existing Supabase receiver remains authoritative.

## Final Developer Instruction

> Build a profile-driven OKF navigation compiler. ATA 27 is the first profile, not hard-coded behavior. The compiler must generate one root, configured subsystem hubs, deterministic `part_of` membership, normal Markdown navigation links, and source-supported typed relations using the existing `okf-base.yaml` vocabulary. Every technical article must be reachable from its root. Record the navigation profile and compiler versions in the immutable package, and prove modularity with ATA 27, another ATA chapter, and a pilot or QRH fixture. The publisher must only publish the resulting validated package through Project EFB's existing receiver contract.

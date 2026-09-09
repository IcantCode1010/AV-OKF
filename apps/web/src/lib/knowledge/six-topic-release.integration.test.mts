import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { deterministicClassification } from "./efb-classification-core.ts";
import { parseNavigationProfile } from "../navigation/load-profile.ts";
import { compileNavigation } from "../navigation/compiler.ts";
import { materializeCompiledNavigation } from "../navigation/materialize-package.ts";
import { serializeOkfMarkdown } from "../okf-frontmatter.ts";
import { EFB_POC_AUTHORITY_LABEL, EFB_UNREVIEWED_LICENSE_IDENTIFIER, exportEfbRelease } from "../efb-release-export.ts";
import { publishEfbPackage } from "../efb-publisher/publish-package.ts";

const registry = {
  schemaVersion: "1.0" as const,
  aircraftFamilies: [
    { id: "737-ng", aircraftTypeIds: [] },
    { id: "737-max", aircraftTypeIds: [] },
    { id: "a320", aircraftTypeIds: [] },
  ],
  placements: { ataChapterIds: ["27"], qrhTargetIds: ["flight-controls"], quickAccessTargetIds: [] },
};
const fixtures = [
  ["ng-flaps", "737-ng", "737-800 ATA 27 trailing-edge flap operation", "flaps"],
  ["ng-rudder", "737-ng", "737-900 ATA 27 rudder operation", "rudder"],
  ["max-flaps", "737-max", "737 MAX 8 ATA 27 trailing-edge flap operation", "flaps"],
  ["max-rudder", "737-max", "737 MAX 9 ATA 27 rudder operation", "rudder"],
  ["a319-flaps", "a320", "Airbus A319 ATA 27 trailing-edge flap operation", "flaps"],
  ["a320-rudder", "a320", "Airbus A320 ATA 27 rudder operation", "rudder"],
] as const;

test("six source-grounded topics classify, compile, package, import and activate", async () => {
  const outputRoot = await mkdtemp(path.join(tmpdir(), "av-okf-six-topic-"));
  try {
    for (const [, family, evidence] of fixtures) {
      const classification = deterministicClassification(registry, [{ id: "page-1", documentId: `doc-${family}`, page: 1, quote: evidence }], [{ aircraftFamilyIds: [family], aircraftTypeIds: [], applicabilityStatus: "accepted" }]);
      assert.deepEqual(classification.aircraftFamilyIds, [family]);
      assert.deepEqual(classification.ataChapters, ["27"]);
      assert.deepEqual(classification.issues, []);
    }
    const profile = parseNavigationProfile(`
profile_id: six-topic-flight-controls
profile_version: 1
placement: { kind: ata, target_id: "27" }
root: { entry_id: six-topic-root, title: Flight Controls, type: index }
hubs:
  - entry_id: six-topic-flaps
    title: Trailing-Edge Flaps
    type: index
    match: { field: topic_group, values: [flaps] }
  - entry_id: six-topic-rudder
    title: Rudder
    type: index
    match: { field: topic_group, values: [rudder] }
applicable_types: [system_topic]
display_order: { start: 10, increment: 10, articles: entry-id, tie_breaker: entry-id, hubs: profile-order }
standalone: reject
`, { placements: registry.placements, objectTypes: ["index", "system_topic"] });
    const articles = fixtures.map(([id, , evidence, group], index) => ({ id, title: evidence, type: "system_topic", relativePath: `topics/${id}.md`, sourceOrder: index, metadata: { topic_group: group } }));
    const compiled = compileNavigation({ profile, articles, allowedRelations: ["part_of"] });
    assert.equal(compiled.report.reachableTechnicalArticleCount, 6);
    const sourceEntries = fixtures.map(([id, family, evidence]) => ({
      relativePath: `topics/${id}.md`,
      markdown: serializeOkfMarkdown({ frontmatter: {
        type: "system_topic", title: evidence, description: evidence, status: "stable", efb_entry_id: id,
        sources: [{ id: `${id}-page-1`, resource: `urn:fixture:${id}:page:1`, title: `${id}, page 1` }],
        source_pages: [1], efb_aircraft_family_ids: [family], efb_aircraft_type_ids: [], efb_audiences: ["maintenance"],
        efb_placements: ["ata:27:100"], efb_license_identifier: EFB_UNREVIEWED_LICENSE_IDENTIFIER,
        efb_authority_label: EFB_POC_AUTHORITY_LABEL, efb_inclusion_status: "approved-for-inclusion", efb_related_entry_ids: [],
      }, body: `${evidence}. Educational overview grounded in fixture page 1.` }),
    }));
    const materialized = materializeCompiledNavigation({ compiled, sourceEntries, context: { aircraftFamilyIds: ["737-ng", "737-max", "a320"], aircraftTypeIds: [], audiences: ["maintenance"], authorityLabel: EFB_POC_AUTHORITY_LABEL, licenseIdentifier: EFB_UNREVIEWED_LICENSE_IDENTIFIER, placement: { kind: "ata", targetId: "27" } } });
    const now = "2026-09-09T12:00:00.000Z";
    const exported = await exportEfbRelease({
      config: { schemaVersion: "1.0", mode: "poc-cloud", packageId: "six-topic-proof", version: "1.0.0", source: "fixtures", sourceCommit: "a".repeat(40), curator: "test", curatedAt: now, validatedAt: now, validator: "test", validationProfile: "six-topic", license: { identifier: EFB_UNREVIEWED_LICENSE_IDENTIFIER } },
      outputRoot, sourceEntries: materialized, contractRegistry: registry,
      navigation: { compilerVersion: compiled.compilerVersion, profileId: profile.profile_id, profileVersion: profile.profile_version, rootEntryId: compiled.root.id, rootCount: 1, hubCount: compiled.hubs.length, technicalArticleCount: 6, reachableTechnicalArticleCount: 6, navigationEdgeCount: compiled.report.navigationEdgeCount, technicalRelationCount: 0, report: compiled.report },
      signer: async () => ({ algorithm: "ed25519", keyId: "fixture-key", value: "fixture-signature" }),
    });
    assert.equal(exported.manifest.entries.length, 9);
    assert.equal(exported.manifest.navigation?.technicalArticleCount, 6);
    const actions: string[] = [];
    const published = await publishEfbPackage({ packageDirectory: exported.releaseDirectory, dryRun: false, activate: true, upload: async () => new Response(null, { status: 200 }), api: async (body) => {
      actions.push(String(body.action));
      if (body.action === "initialize") return { state: "staged" };
      if (body.action === "upload") return { verified: false, signedUrl: "https://upload.invalid/artifact" };
      if (body.action === "complete") return { state: "validated" };
      if (body.action === "prepare") return "11111111-1111-1111-1111-111111111111";
      if (body.action === "inspect") return { packageCount: 1, entryCount: 9 };
      return {};
    } });
    assert.equal(published.activated, true);
    assert.deepEqual(actions.filter((action) => ["initialize", "complete", "prepare", "inspect", "activate"].includes(action)), ["initialize", "complete", "prepare", "inspect", "activate"]);
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});

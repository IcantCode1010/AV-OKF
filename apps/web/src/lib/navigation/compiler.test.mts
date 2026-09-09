import assert from "node:assert/strict";
import test from "node:test";
import { parseNavigationProfile } from "./load-profile.ts";
import { compileNavigation } from "./compiler.ts";

const registry = {
  placements: { ataChapterIds: ["27", "29"], qrhTargetIds: ["flight-controls"], quickAccessTargetIds: [] },
  objectTypes: ["index", "system_topic"],
};
const profile = (input: { id: string; kind: "ata" | "qrh"; target: string; hubs: Array<[string, string]> }) => parseNavigationProfile(`
profile_id: ${input.id}
profile_version: 1
placement: { kind: ${input.kind}, target_id: "${input.target}" }
root: { entry_id: ${input.id}-root, title: Root, type: index }
hubs:
${input.hubs.map(([id, value]) => `  - entry_id: ${input.id}-${id}\n    title: ${id}\n    type: index\n    match: { field: topic_group, values: [${value}] }`).join("\n")}
applicable_types: [system_topic]
display_order: { start: 10, increment: 10, articles: source-order, tie_breaker: entry-id, hubs: profile-order }
standalone: explicit-approved-only
`, registry);

test("compiles root, hubs, portable links and deterministic part_of membership", () => {
  const p = profile({ id: "ata-27", kind: "ata", target: "27", hubs: [["flaps", "flaps"], ["rudder", "rudder"]] });
  const result = compileNavigation({
    profile: p,
    allowedRelations: ["part_of", "references"],
    articles: [
      { id: "article-rudder", title: "Rudder", type: "system_topic", relativePath: "topics/article-rudder.md", sourceOrder: 2, metadata: { topic_group: "rudder" } },
      { id: "article-flaps", title: "Flaps", type: "system_topic", relativePath: "topics/article-flaps.md", sourceOrder: 1, metadata: { topic_group: "flaps" }, technicalRelations: [{ relation: "references", target: "article-rudder", targetType: "system_topic", reason: "Approved source relation." }] },
    ],
  });
  assert.equal(result.report.result, "pass");
  assert.equal(result.report.reachableTechnicalArticleCount, 2);
  assert.equal(result.report.navigationEdgeCount, 4);
  assert.equal(result.report.technicalRelationCount, 1);
  assert.match(result.root.markdown, /\.\/ata-27-flaps\.md/);
  assert.match(result.hubs[0]!.markdown, /\.\.\/topics\/article-flaps\.md/);
  assert.deepEqual(result.memberships.map((item) => item.articleId), ["article-flaps", "article-rudder"]);
});

test("uses the highest-priority assignment and rejects ambiguity at that priority", () => {
  const p = profile({ id: "ata-29", kind: "ata", target: "29", hubs: [["pump", "pump"], ["reservoir", "reservoir"]] });
  const selected = compileNavigation({ profile: p, allowedRelations: ["part_of"], articles: [{ id: "article", title: "Hydraulics", type: "system_topic", relativePath: "topics/article.md", approvedHubEntryId: "ata-29-pump", metadata: { topic_group: "reservoir" } }] });
  assert.equal(selected.memberships[0]!.parentEntryId, "ata-29-pump");
  assert.throws(() => compileNavigation({ profile: p, allowedRelations: ["part_of"], articles: [{ id: "ambiguous", title: "Ambiguous", type: "system_topic", relativePath: "topics/ambiguous.md", metadata: { topic_group: ["pump", "reservoir"] } }] }), /navigation_ambiguous_membership/);
});

test("the same compiler supports a QRH profile and explicit standalone articles", () => {
  const p = profile({ id: "qrh-controls", kind: "qrh", target: "flight-controls", hubs: [["normal", "normal"]] });
  const result = compileNavigation({ profile: p, allowedRelations: ["part_of"], articles: [
    { id: "normal-checklist", title: "Normal", type: "system_topic", relativePath: "topics/normal.md", metadata: { topic_group: "normal" } },
    { id: "overview", title: "Overview", type: "system_topic", relativePath: "topics/overview.md", metadata: {}, standaloneApproved: true },
  ] });
  assert.equal(result.report.result, "pass");
  assert.equal(result.memberships.find((item) => item.articleId === "overview")?.parentEntryId, p.root.entry_id);
});

test("fails closed for unassigned articles and unsupported technical relations", () => {
  const p = profile({ id: "ata-29", kind: "ata", target: "29", hubs: [["pump", "pump"]] });
  assert.throws(() => compileNavigation({ profile: p, allowedRelations: ["part_of"], articles: [{ id: "lost", title: "Lost", type: "system_topic", relativePath: "topics/lost.md", metadata: {} }] }), /navigation_article_unassigned/);
  assert.throws(() => compileNavigation({ profile: p, allowedRelations: ["part_of"], articles: [{ id: "pump", title: "Pump", type: "system_topic", relativePath: "topics/pump.md", metadata: { topic_group: "pump" }, technicalRelations: [{ relation: "invented", target: "pump", targetType: "system_topic", reason: "No" }] }] }), /navigation_relation_not_allowed/);
});

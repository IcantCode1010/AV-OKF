import assert from "node:assert/strict";
import test from "node:test";
import { parseNavigationProfile } from "./load-profile.ts";
import { compileNavigation } from "./compiler.ts";
import { materializeCompiledNavigation } from "./materialize-package.ts";
import { parseOkfMarkdown, serializeOkfMarkdown } from "../okf-frontmatter.ts";

test("materializes generated nodes and structural relations as native OKF Markdown", () => {
  const profile = parseNavigationProfile(`
profile_id: test-nav
profile_version: 1
placement: { kind: ata, target_id: "27" }
root: { entry_id: test-root, title: Test Root, type: index }
hubs:
  - entry_id: test-hub
    title: Test Hub
    type: index
    match: { field: topic_group, values: [flaps] }
applicable_types: [system_topic]
display_order: { start: 10, increment: 10, articles: entry-id, tie_breaker: entry-id, hubs: profile-order }
standalone: reject
`, { placements: { ataChapterIds: ["27"], qrhTargetIds: [], quickAccessTargetIds: [] }, objectTypes: ["index", "system_topic"] });
  const compiled = compileNavigation({ profile, allowedRelations: ["part_of"], articles: [{ id: "article-one", title: "Article One", type: "system_topic", relativePath: "topics/article-one.md", metadata: { topic_group: "flaps" } }] });
  const article = serializeOkfMarkdown({ frontmatter: { type: "system_topic", title: "Article One", efb_entry_id: "article-one" }, body: "Article body." });
  const output = materializeCompiledNavigation({ compiled, sourceEntries: [{ relativePath: "topics/article-one.md", markdown: article }], context: { aircraftFamilyIds: ["737-ng"], aircraftTypeIds: [], audiences: ["maintenance"], authorityLabel: "Prototype knowledge — not approved operational data", licenseIdentifier: "POC-NOT-REVIEWED", placement: { kind: "ata", targetId: "27" } } });
  assert.equal(output.length, 3);
  const parsed = parseOkfMarkdown(output[0]!.markdown);
  assert.deepEqual(parsed.frontmatter.relations, [{ relation: "part_of", target: "../indexes/test-hub.md", target_type: "index", reason: "This article is part of Test Hub." }]);
  assert.match(output.find((entry) => entry.relativePath === "indexes/test-root.md")!.markdown, /\.\/test-hub\.md/);
  assert.match(output.find((entry) => entry.relativePath === "indexes/test-hub.md")!.markdown, /\.\.\/topics\/article-one\.md/);
});

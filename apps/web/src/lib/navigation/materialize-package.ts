import path from "node:path";
import type { EfbReleaseSourceEntry } from "../efb-release-export.ts";
import { parseOkfMarkdown, serializeOkfMarkdown } from "../okf-frontmatter.ts";
import type { CompiledNavigation } from "./types.ts";

export type NavigationPackageContext = {
  aircraftFamilyIds: string[];
  aircraftTypeIds: string[];
  audiences: Array<"pilot" | "maintenance">;
  authorityLabel: string;
  licenseIdentifier: string;
  placement: { kind: "ata" | "qrh" | "quick-access"; targetId: string };
};

export function materializeCompiledNavigation(input: {
  compiled: CompiledNavigation;
  sourceEntries: EfbReleaseSourceEntry[];
  context: NavigationPackageContext;
}): EfbReleaseSourceEntry[] {
  const membershipByArticle = new Map(input.compiled.memberships.map((membership) => [membership.articleId, membership]));
  const nodes = new Map([input.compiled.root, ...input.compiled.hubs].map((node) => [node.id, node]));
  const technical = input.sourceEntries.map((source) => {
    const parsed = parseOkfMarkdown(source.markdown);
    const id = typeof parsed.frontmatter.efb_entry_id === "string" ? parsed.frontmatter.efb_entry_id : "";
    const membership = membershipByArticle.get(id);
    if (!membership) throw Error(`navigation_source_entry_unclassified:${id || source.relativePath}`);
    const parent = nodes.get(membership.parentEntryId);
    if (!parent) throw Error(`navigation_parent_missing:${membership.parentEntryId}`);
    const target = path.posix.relative(path.posix.dirname(source.relativePath), parent.relativePath);
    const relations = Array.isArray(parsed.frontmatter.relations) ? parsed.frontmatter.relations : [];
    return {
      relativePath: source.relativePath,
      markdown: serializeOkfMarkdown({
        frontmatter: {
          ...parsed.frontmatter,
          relations: [...relations, { relation: "part_of", target, target_type: parent.type, reason: `This article is part of ${parent.title}.` }],
          navigation: {
            profile_id: input.compiled.profile.profile_id,
            profile_version: input.compiled.profile.profile_version,
            root_entry_id: input.compiled.root.id,
            hub_entry_id: parent.id === input.compiled.root.id ? null : parent.id,
            display_order: membership.displayOrder,
            classification_method: membership.classificationMethod,
            confidence: membership.confidence,
          },
        },
        body: parsed.body,
      }),
    };
  });
  const generated = [input.compiled.root, ...input.compiled.hubs].map((node, index) => ({
    relativePath: node.relativePath,
    markdown: serializeOkfMarkdown({
      frontmatter: {
        type: node.type,
        title: node.title,
        description: `Navigation for ${node.title}`,
        okf_version: "0.2",
        status: "stable",
        generated: { by: `av-okf-navigation-${input.compiled.compilerVersion}` },
        sources: [{ id: `profile-${input.compiled.profile.profile_id}`, resource: `urn:av-okf:navigation-profile:${input.compiled.profile.profile_id}:v${input.compiled.profile.profile_version}`, title: `${input.compiled.profile.profile_id} navigation profile` }],
        efb_entry_id: node.id,
        efb_aircraft_family_ids: input.context.aircraftFamilyIds,
        efb_aircraft_type_ids: input.context.aircraftTypeIds,
        efb_audiences: input.context.audiences,
        efb_placements: [`${input.context.placement.kind}:${input.context.placement.targetId}:${index}`],
        efb_license_identifier: input.context.licenseIdentifier,
        efb_authority_label: input.context.authorityLabel,
        efb_inclusion_status: "approved-for-inclusion",
        efb_related_entry_ids: node.childIds,
      },
      body: node.markdown,
    }),
  }));
  return [...technical, ...generated];
}

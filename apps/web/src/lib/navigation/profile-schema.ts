import { z } from "zod";

export const navigationIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const objectType = z.string().trim().min(1).max(100).regex(/^[^\r\n]+$/);
const node = z.object({
  entry_id: navigationIdSchema,
  title: z.string().trim().min(1).max(250),
  type: objectType,
}).strict();

export const navigationProfileSchema = z.object({
  profile_id: navigationIdSchema,
  profile_version: z.number().int().positive(),
  placement: z.object({
    kind: z.enum(["ata", "qrh", "quick-access"]),
    target_id: navigationIdSchema,
  }).strict(),
  root: node,
  hubs: z.array(node.extend({
    match: z.object({
      field: z.string().regex(/^[a-z][a-z0-9_]*$/),
      values: z.array(z.string().trim().min(1)).min(1),
    }).strict(),
  })).max(100),
  applicable_types: z.array(objectType).min(1),
  display_order: z.object({
    start: z.number().int().nonnegative().max(1_000_000),
    increment: z.number().int().positive().max(10_000),
    articles: z.enum(["source-order", "title", "entry-id"]),
    tie_breaker: z.literal("entry-id"),
    hubs: z.literal("profile-order"),
  }).strict(),
  standalone: z.enum(["reject", "explicit-approved-only"]),
}).strict().superRefine((profile, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  const ids = [profile.root.entry_id, ...profile.hubs.map(hub => hub.entry_id)];
  if (new Set(ids).size !== ids.length) issue("navigation_duplicate_node_id");
  if (new Set(profile.applicable_types).size !== profile.applicable_types.length)
    issue("navigation_duplicate_applicable_type");
  if (profile.placement.kind === "ata" && !/^\d{2}$/.test(profile.placement.target_id))
    issue("navigation_invalid_ata_target");
  const matches = new Set<string>();
  for (const hub of profile.hubs) {
    for (const value of hub.match.values) {
      const key = JSON.stringify([hub.match.field, value]);
      if (matches.has(key)) issue("navigation_ambiguous_match_rule");
      matches.add(key);
    }
  }
});

export type NavigationProfile = z.infer<typeof navigationProfileSchema>;
export type NavigationProfileRegistry = {
  placements: { ataChapterIds: readonly string[]; qrhTargetIds: readonly string[]; quickAccessTargetIds: readonly string[] };
  objectTypes: readonly string[];
};

export function validateNavigationProfile(value: unknown, registry: NavigationProfileRegistry): NavigationProfile {
  const profile = navigationProfileSchema.parse(value);
  const targets = {
    ata: registry.placements.ataChapterIds,
    qrh: registry.placements.qrhTargetIds,
    "quick-access": registry.placements.quickAccessTargetIds,
  }[profile.placement.kind];
  if (!targets.includes(profile.placement.target_id)) throw Error("navigation_placement_not_supported");
  const types = [profile.root.type, ...profile.hubs.map(hub => hub.type), ...profile.applicable_types];
  if (types.some(type => !registry.objectTypes.includes(type))) throw Error("navigation_object_type_not_supported");
  return profile;
}

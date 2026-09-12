import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

import { z } from "zod";

const registrySchema = z.object({
  schemaVersion: z.literal("1.0"),
  aircraftFamilies: z.array(z.object({
    id: z.string().min(1),
    aircraftTypeIds: z.array(z.string().min(1)),
  }).strict()).min(1),
  placements: z.object({
    ataChapterIds: z.array(z.string().regex(/^\d{2}$/)).min(1),
    qrhTargetIds: z.array(z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)).min(1),
    quickAccessTargetIds: z.array(z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)),
  }).strict(),
}).strict();

export type ProjectEfbContractRegistry = z.infer<typeof registrySchema>;

export function registryFingerprint(registry: ProjectEfbContractRegistry): string {
  return createHash("sha256").update(JSON.stringify({
    schemaVersion: registry.schemaVersion,
    aircraftFamilies: registry.aircraftFamilies.map(f => ({ id: f.id, aircraftTypeIds: [...f.aircraftTypeIds].sort() })).sort((a,b) => a.id.localeCompare(b.id)),
    placements: Object.fromEntries(Object.entries(registry.placements).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => [k, [...v].sort()])),
  })).digest("hex");
}

export async function loadProjectEfbContractRegistry(
  projectEfbRoot = process.env.PROJECT_EFB_ROOT,
): Promise<ProjectEfbContractRegistry> {
  if (!projectEfbRoot) throw new Error("configure_project_efb_registry_first");
  const file = path.join(
    path.resolve(projectEfbRoot),
    "contracts",
    "registries",
    "project-efb-knowledge-registry.v1.json",
  );
  const registry = registrySchema.parse(JSON.parse(await readFile(file, "utf8")));
  assertUnique(registry.aircraftFamilies.map(({ id }) => id), "project_efb_registry_duplicate_family");
  assertUnique(registry.aircraftFamilies.flatMap(({ aircraftTypeIds }) => aircraftTypeIds), "project_efb_registry_duplicate_aircraft_type");
  assertUnique(registry.placements.ataChapterIds, "project_efb_registry_duplicate_ata");
  assertUnique(registry.placements.qrhTargetIds, "project_efb_registry_duplicate_qrh");
  return registry;
}

function assertUnique(values: string[], code: string): void {
  if (new Set(values).size !== values.length) throw new Error(code);
}

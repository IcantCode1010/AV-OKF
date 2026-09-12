import { readFile } from "node:fs/promises";
import { parseDocument } from "yaml";

export async function getAllowedRelations(
  manifestPath = getDefaultManifestPath(),
): Promise<string[]> {
  const manifest = await readFile(
    /*turbopackIgnore: true*/ manifestPath,
    "utf8",
  );
  const document = parseDocument(manifest, {
    strict: true,
    uniqueKeys: true,
  });
  if (document.errors.length > 0) throw new Error("invalid_okf_manifest");
  const value = document.toJS({ maxAliasCount: 0 }) as {
    relations?: { allowed?: unknown };
  };
  const allowed = value.relations?.allowed;
  if (
    !Array.isArray(allowed) ||
    allowed.length === 0 ||
    allowed.some((relation) => typeof relation !== "string" || relation.trim() === "")
  ) {
    throw new Error("missing_allowed_relations");
  }

  return allowed.map((relation) => relation.trim());
}

function getDefaultManifestPath(): string {
  return process.env.AV_OKF_MANIFEST_PATH ?? "../../okf-base.yaml";
}

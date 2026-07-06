import { readFile } from "node:fs/promises";

export async function getAllowedRelations(
  manifestPath = getDefaultManifestPath(),
): Promise<string[]> {
  const manifest = await readFile(
    /*turbopackIgnore: true*/ manifestPath,
    "utf8",
  );
  const lines = manifest.split(/\r?\n/);
  const relationsIndex = lines.findIndex((line) => line.trim() === "relations:");
  const allowedIndex = lines.findIndex(
    (line, index) => index > relationsIndex && line.trim() === "allowed:",
  );
  const allowed: string[] = [];

  for (const line of lines.slice(allowedIndex + 1)) {
    if (!line.startsWith("  - ")) {
      break;
    }

    allowed.push(line.trim().slice(2).trim());
  }

  if (relationsIndex === -1 || allowedIndex === -1 || allowed.length === 0) {
    throw new Error("missing_allowed_relations");
  }

  return allowed;
}

function getDefaultManifestPath(): string {
  return process.env.AV_OKF_MANIFEST_PATH ?? "../../okf-base.yaml";
}

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const manifestSchema = z.object({
  schemaVersion: z.literal("2.1"), id: z.string().min(1), signature: z.object({ algorithm: z.literal("ed25519"), keyId: z.string().min(1), value: z.string().min(1) }),
  entries: z.array(z.object({ contentArtifactPath: z.string(), agentArtifactPath: z.string() }).passthrough()).min(1),
  nativeArtifacts: z.array(z.string()).min(2),
}).passthrough();

export async function inspectPublishablePackage(packageDirectory: string) {
  const root = path.resolve(packageDirectory);
  const manifest = manifestSchema.parse(JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8")));
  const paths = [...new Set([...manifest.entries.flatMap((entry) => [entry.contentArtifactPath, entry.agentArtifactPath]), "retrieval.jsonl", ...manifest.nativeArtifacts])].sort();
  const artifacts = await Promise.all(paths.map(async (artifactPath) => {
    const resolved = path.resolve(root, artifactPath);
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw Error("efb_package_artifact_path_unsafe");
    const bytes = await readFile(resolved);
    return { path: artifactPath.replaceAll("\\", "/"), sha256: createHash("sha256").update(bytes).digest("hex"), bytes };
  }));
  return { root, manifest, artifacts };
}

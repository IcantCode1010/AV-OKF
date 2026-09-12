import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { loadProjectEfbContractRegistry } from "./project-efb-contract-registry.ts";

test("loads the consumer-owned Project EFB registry", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "project-efb-registry-"));
  const directory = path.join(root, "contracts", "registries");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "project-efb-knowledge-registry.v1.json"), JSON.stringify({
    schemaVersion: "1.0",
    aircraftFamilies: [{ id: "737-ng", aircraftTypeIds: ["b738"] }],
    placements: {
      ataChapterIds: ["29", "36"],
      qrhTargetIds: ["hydraulics"],
      quickAccessTargetIds: ["maintenance"],
    },
  }));
  const registry = await loadProjectEfbContractRegistry(root);
  assert.deepEqual(registry.placements.ataChapterIds, ["29", "36"]);
});

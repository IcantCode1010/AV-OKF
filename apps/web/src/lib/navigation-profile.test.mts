import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { stringify } from "yaml";
import { loadNavigationProfile, parseNavigationProfile } from "./navigation/load-profile.ts";
import { validateNavigationProfile } from "./navigation/profile-schema.ts";

const directory = fileURLToPath(new URL("../../config/navigation/", import.meta.url));
const registry = {
  placements: { ataChapterIds: ["27", "29"], qrhTargetIds: ["hydraulics"], quickAccessTargetIds: [] },
  objectTypes: ["index", "system_topic", "procedure"],
};
const text = await readFile(new URL("../../config/navigation/737-flight-controls.v1.yaml", import.meta.url), "utf8");
const profile = () => structuredClone(parseNavigationProfile(text, registry));

test("versioned ATA 27 profile has one root, nine hubs and immutable normalized configuration", async () => {
  const result = await loadNavigationProfile({ directory, profileId: "737-flight-controls", version: 1, registry });
  assert.equal(result.profile.hubs.length, 9);
  assert.equal(result.profile.root.entry_id, "ata-27-flight-controls");
  assert.equal(result.profile.placement.target_id, "27");
  assert(Object.isFrozen(result.profile.hubs[0]?.match.values));
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.sha256, (await loadNavigationProfile({ directory, profileId: "737-flight-controls", version: 1, registry })).sha256);
});

test("profile rejects missing roots, duplicate IDs and ambiguous matching", () => {
  const p = profile();
  assert.throws(() => validateNavigationProfile({ ...p, root: undefined }, registry));
  assert.throws(() => validateNavigationProfile({ ...p, hubs: [...p.hubs, p.hubs[0]] }, registry));
  assert.throws(() => validateNavigationProfile({ ...p, hubs: [...p.hubs, { ...p.hubs[0], entry_id: "another-hub" }] }, registry));
});

test("receiver registry controls placements and object types", () => {
  const p = profile();
  assert.throws(() => validateNavigationProfile({ ...p, placement: { kind: "ata", target_id: "36" } }, registry), /placement_not_supported/);
  assert.throws(() => validateNavigationProfile({ ...p, placement: { kind: "ata", target_id: "737sar" } }, registry));
  assert.throws(() => validateNavigationProfile({ ...p, root: { ...p.root, type: "invented" } }, registry), /object_type_not_supported/);
});

test("same contract accepts another chapter and QRH with different layouts", () => {
  for (const placement of [{ kind: "ata", target_id: "29" }, { kind: "qrh", target_id: "hydraulics" }]) {
    const p = { ...profile(), profile_id: "hydraulics", root: { entry_id: "hydraulics-root", title: "Hydraulics", type: "index" }, hubs: [], placement };
    assert.equal(validateNavigationProfile(p, registry).placement.target_id, placement.target_id);
  }
});

test("profile parsing rejects unsafe YAML and malformed configuration", () => {
  assert.throws(() => parseNavigationProfile(`${text}\nprofile_version: 2\n`, registry));
  assert.throws(() => parseNavigationProfile("root: &root {title: example}\nhubs: [*root]", registry));
  assert.throws(() => parseNavigationProfile("root: !custom example", registry));
  assert.throws(() => parseNavigationProfile("- list", registry));
  assert.throws(() => parseNavigationProfile(" ".repeat(256 * 1024 + 1), registry));
  assert.deepEqual(parseNavigationProfile(text.replaceAll("\n", "\r\n"), registry), parseNavigationProfile(text, registry));
  assert.deepEqual(parseNavigationProfile(stringify(profile()), registry), profile());
});

test("named loader rejects unsafe identities and invalid versions before file access", async () => {
  for (const profileId of ["../escape", "C:/escape", "a/b", "a\\b", "%2e%2e"]) {
    await assert.rejects(loadNavigationProfile({ directory, profileId, version: 1, registry }));
  }
  await assert.rejects(loadNavigationProfile({ directory, profileId: "safe", version: 0, registry }));
});

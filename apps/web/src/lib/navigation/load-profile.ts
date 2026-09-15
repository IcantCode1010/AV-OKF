import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { isAlias, parseDocument, visit } from "yaml";
import { navigationIdSchema, validateNavigationProfile, type NavigationProfileRegistry } from "./profile-schema.ts";

export function parseNavigationProfile(text: string, registry: NavigationProfileRegistry) {
  if (Buffer.byteLength(text, "utf8") > 256 * 1024) throw Error("navigation_profile_too_large");
  const document = parseDocument(text, { schema: "core", uniqueKeys: true, prettyErrors: false });
  if (document.errors.length || document.warnings.length) throw Error("navigation_profile_invalid_yaml");
  visit(document, (_key, node) => {
    if (isAlias(node)) throw Error("navigation_profile_alias_forbidden");
  });
  return freezeDeep(validateNavigationProfile(document.toJS({ maxAliasCount: 0 }), registry));
}

type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;
function freezeDeep<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

export async function loadNavigationProfile(input: {
  directory: string;
  profileId: string;
  version: number;
  registry: NavigationProfileRegistry;
}) {
  navigationIdSchema.parse(input.profileId);
  if (!Number.isSafeInteger(input.version) || input.version < 1) throw Error("navigation_profile_version_invalid");
  const root = await realpath(input.directory);
  const filename = await realpath(path.join(root, `${input.profileId}.v${input.version}.yaml`));
  const relative = path.relative(root, filename);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw Error("navigation_profile_path_unsafe");
  const info = await stat(filename);
  if (!info.isFile() || info.size > 256 * 1024) throw Error("navigation_profile_too_large");
  const text = await readFile(filename, "utf8");
  const profile = parseNavigationProfile(text, input.registry);
  if (profile.profile_id !== input.profileId || profile.profile_version !== input.version)
    throw Error("navigation_profile_identity_mismatch");
  return Object.freeze({ profile, sha256: createHash("sha256").update(text).digest("hex") });
}

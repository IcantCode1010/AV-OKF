import { execFile } from "node:child_process";
import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import {
  exportEfbRelease,
  type EfbReleaseConfig,
} from "../src/lib/efb-release-export.ts";

const execFileAsync = promisify(execFile);
const args = parseArgs(process.argv.slice(2));
const configPath = requiredArg(args, "config");
const knowledgeRoot = path.resolve(requiredArg(args, "knowledge-root"));
const outputRoot = path.resolve(requiredArg(args, "out"));
const efbRoot = path.resolve(
  args.get("efb-contract-root") ?? process.env.PROJECT_EFB_ROOT ?? "",
);
if (!args.get("efb-contract-root") && !process.env.PROJECT_EFB_ROOT) {
  throw new Error("efb_contract_root_required: use --efb-contract-root or PROJECT_EFB_ROOT");
}
const signingPrivateKeyPath = path.resolve(requiredArg(args, "signing-private-key"));
const signingPublicKeyPath = path.resolve(requiredArg(args, "signing-public-key"));
const signingKeyId = requiredArg(args, "signing-key-id");

const config = JSON.parse(await readFile(path.resolve(configPath), "utf8")) as EfbReleaseConfig;
const { stdout: head } = await execFileAsync("git", ["rev-parse", "HEAD"], {
  cwd: path.resolve(import.meta.dirname, "../../.."),
});
if (head.trim() !== config.sourceCommit) {
  throw new Error(`efb_source_commit_mismatch: expected ${config.sourceCommit}, found ${head.trim()}`);
}
const { stdout: worktreeStatus } = await execFileAsync(
  "git",
  ["status", "--porcelain", "--untracked-files=all"],
  { cwd: path.resolve(import.meta.dirname, "../../..") },
);
if (worktreeStatus.trim()) {
  throw new Error("efb_source_worktree_dirty: commit all release inputs before export");
}

const privateKey = createPrivateKey(await readFile(signingPrivateKeyPath, "utf8"));
if (privateKey.asymmetricKeyType !== "ed25519") {
  throw new Error("efb_signing_key_must_be_ed25519");
}
const publicKey = createPublicKey(await readFile(signingPublicKeyPath, "utf8"));
if (publicKey.asymmetricKeyType !== "ed25519") {
  throw new Error("efb_signing_public_key_must_be_ed25519");
}
const derivedPublicKey = createPublicKey(privateKey).export({ format: "der", type: "spki" });
const suppliedPublicKey = publicKey.export({ format: "der", type: "spki" });
if (!derivedPublicKey.equals(suppliedPublicKey)) {
  throw new Error("efb_signing_key_pair_mismatch");
}
const result = await exportEfbRelease({
  config,
  knowledgeRoot,
  outputRoot,
  signer: async (payload) => ({
    algorithm: "ed25519",
    keyId: signingKeyId,
    value: sign(null, Buffer.from(payload, "utf8"), privateKey).toString("base64"),
  }),
  validateStagedPackage: async (manifestPath) => {
    const validator = path.join(efbRoot, "scripts", "validate-knowledge-package.mjs");
    await execFileAsync(process.execPath, [
      validator,
      manifestPath,
      "--require-signature",
      "--public-key",
      signingPublicKeyPath,
      "--expected-key-id",
      signingKeyId,
    ], { cwd: efbRoot });
  },
});
console.log(`EFB release exported and contract-validated: ${result.releaseDirectory}`);

function parseArgs(values: string[]): Map<string, string> {
  const parsed = new Map<string, string>();
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || !value) throw new Error(`invalid_argument:${key ?? "missing"}`);
    parsed.set(key.slice(2), value);
  }
  return parsed;
}

function requiredArg(args: Map<string, string>, name: string): string {
  const value = args.get(name);
  if (!value) throw new Error(`required_argument_missing:${name}`);
  return value;
}

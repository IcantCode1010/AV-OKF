import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  buildEfbReviewPacket,
  type EfbReviewPacketConfig,
} from "../src/lib/efb-review-packet.ts";

const args = parseArgs(process.argv.slice(2));
const vaultPath = path.resolve(requiredArg(args, "vault"));
const configPath = path.resolve(requiredArg(args, "config"));
const outputPath = path.resolve(requiredArg(args, "out"));
const vault = JSON.parse(await readFile(vaultPath, "utf8"));
const config = JSON.parse(await readFile(configPath, "utf8")) as EfbReviewPacketConfig;
const packet = buildEfbReviewPacket({
  config,
  createdAt: new Date().toISOString(),
  vault,
});
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(packet, null, 2)}\n`, "utf8");
console.log(`EFB human-review packet prepared without changing approval state: ${outputPath}`);

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

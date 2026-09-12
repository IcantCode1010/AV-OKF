import { readFile } from "node:fs/promises";
import path from "node:path";

import { parseOkfMarkdown } from "./okf-frontmatter.ts";

export const REQUIRED_OKF_VERSION = "0.2";

export async function assertOkfV02Bundle(input: {
  knowledgeRoot: string;
  okfVersion: string;
}) {
  if (input.okfVersion !== REQUIRED_OKF_VERSION) {
    throw new Error("okf_bundle_requires_v0_2_migration");
  }
  let markdown: string;
  try {
    markdown = await readFile(path.join(input.knowledgeRoot, "index.md"), "utf8");
  } catch {
    throw new Error("okf_bundle_requires_v0_2_migration");
  }
  const parsed = parseOkfMarkdown(markdown);
  if (parsed.frontmatter.okf_version !== REQUIRED_OKF_VERSION) {
    throw new Error("okf_bundle_requires_v0_2_migration");
  }
}

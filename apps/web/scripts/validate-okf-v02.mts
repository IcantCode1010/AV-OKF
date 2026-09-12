import path from "node:path";

import { validateOkfV02BundleRoot } from "../src/lib/okf-v02-validation.ts";

const root = path.resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("usage: pnpm validate:okf-v0.2 <bundle-root>");
const issues = await validateOkfV02BundleRoot(root);
if (issues.length > 0) {
  console.error(JSON.stringify({ issues, root, valid: false }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ issues: [], root, valid: true }, null, 2));
}

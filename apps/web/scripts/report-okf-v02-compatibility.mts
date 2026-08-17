import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildOkfV02CompatibilityReport } from "../src/lib/okf-v02-compatibility.ts";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const corpusRoot = path.resolve(scriptDirectory, "../test-fixtures/okf-v02-upstream");
const reportPath = path.resolve(
  scriptDirectory,
  "../../../docs/debug/okf-v02-upstream-compatibility.json",
);
const serialized = `${JSON.stringify(
  await buildOkfV02CompatibilityReport({ corpusRoot }),
  null,
  2,
)}\n`;

if (process.argv.includes("--write")) {
  await writeFile(reportPath, serialized, "utf8");
  console.log(`Wrote ${reportPath}`);
} else if (process.argv.includes("--check")) {
  const committed = await readFile(reportPath, "utf8");
  if (committed !== serialized) {
    throw new Error("okf_v02_compatibility_report_out_of_date");
  }
  console.log("OKF v0.2 compatibility report is current.");
} else {
  process.stdout.write(serialized);
}

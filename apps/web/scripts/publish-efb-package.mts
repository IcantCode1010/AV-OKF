import { createPublisherApi, loadPublisherConfig } from "../src/lib/efb-publisher/config.ts";
import { publishEfbPackage, rollbackEfbRelease } from "../src/lib/efb-publisher/publish-package.ts";

const [command, target, ...flags] = process.argv.slice(2);
const activate = flags.includes("--activate");
if (command === "plan") {
  if (!target) throw Error("usage: publish-efb-package plan <package-directory> [--activate]");
  // Planning validates local package structure and performs no network request.
  const result = await publishEfbPackage({ packageDirectory: target, activate, dryRun: true, api: async () => { throw Error("dry_run_network_forbidden"); } });
  console.log(JSON.stringify(result, null, 2));
} else if (command === "publish") {
  if (!target) throw Error("usage: publish-efb-package publish <package-directory> [--activate]");
  const result = await publishEfbPackage({ packageDirectory: target, activate, dryRun: false, organizationId: process.env.EFB_PRIVATE_ORGANIZATION_ID, api: createPublisherApi(loadPublisherConfig()) });
  console.log(JSON.stringify(result, null, 2));
} else if (command === "rollback") {
  if (!target) throw Error("usage: publish-efb-package rollback <retained-revision-id>");
  console.log(JSON.stringify(await rollbackEfbRelease(createPublisherApi(loadPublisherConfig()), target), null, 2));
} else {
  throw Error("commands: plan, publish, rollback");
}

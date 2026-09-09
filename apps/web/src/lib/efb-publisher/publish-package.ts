import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildPublishPlan } from "./build-publish-plan.ts";
import { inspectPublishablePackage } from "./validate-package.ts";
import type { PublisherApi } from "./types.ts";

type PublishOptions = { api: PublisherApi; packageDirectory: string; activate?: boolean; dryRun?: boolean; organizationId?: string; upload?: typeof fetch };

export async function initializeAndUploadEfbPackage(options: Omit<PublishOptions, "activate" | "dryRun">) {
  const inspected = await inspectPublishablePackage(options.packageDirectory);
  const initialized = await options.api({ action: "initialize", manifest: inspected.manifest, artifacts: inspected.artifacts.map(({ path: artifactPath, sha256 }) => ({ path: artifactPath, sha256 })), ...(options.organizationId ? { organizationId: options.organizationId } : {}) }) as { state?: string };
  if (initialized.state !== "validated") {
    const ordered = [...inspected.artifacts].sort((a, b) => a.path === "native/catalog.json" ? -1 : b.path === "native/catalog.json" ? 1 : a.path.localeCompare(b.path));
    for (const artifact of ordered) {
      const upload = await options.api({ action: "upload", id: inspected.manifest.id, path: artifact.path }) as { verified?: boolean; signedUrl?: string };
      if (!upload.verified) {
        if (!upload.signedUrl) throw Error("efb_publisher_upload_url_missing");
        const response = await (options.upload ?? fetch)(upload.signedUrl, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: await readFile(path.join(inspected.root, artifact.path)) });
        if (!response.ok && ![400, 409].includes(response.status)) throw Error("efb_publisher_artifact_upload_failed");
      }
    }
  }
  return { packageVersionId: inspected.manifest.id, paths: inspected.artifacts.map(({ path: artifactPath }) => artifactPath), alreadyValidated: initialized.state === "validated" };
}

export async function importEfbPackage(api: PublisherApi, packageVersionId: string, paths: string[], alreadyValidated = false) {
  if (!alreadyValidated) {
    const ordered = [...paths].sort((a, b) => a === "native/catalog.json" ? -1 : b === "native/catalog.json" ? 1 : a.localeCompare(b));
    for (let start = 0; start < ordered.length; start += 5)
      await api({ action: "validate", id: packageVersionId, paths: ordered.slice(start, start + 5) });
    for (;;) {
      const completed = await api({ action: "complete", id: packageVersionId }) as { state?: string };
      if (completed.state === "validated") break;
      if (completed.state !== "registering-assets") throw Error("efb_publisher_completion_state_invalid");
    }
  }
  return { packageVersionId, state: "validated" as const };
}

export async function verifyEfbRelease(api: PublisherApi, packageVersionId: string) {
  const revision = await api({ action: "prepare", packages: [packageVersionId] });
  const revisionId = typeof revision === "string" ? revision : (revision as { id?: string; revision?: string }).id ?? (revision as { revision?: string }).revision;
  if (!revisionId) throw Error("efb_publisher_revision_missing");
  return { revisionId, inspection: await api({ action: "inspect", revision: revisionId }) };
}

export async function publishEfbPackage(options: PublishOptions) {
  const inspected = await inspectPublishablePackage(options.packageDirectory);
  const plan = buildPublishPlan(inspected.manifest.id, inspected.artifacts.length, options.activate === true);
  if (options.dryRun !== false) return { dryRun: true, plan };
  const uploaded = await initializeAndUploadEfbPackage(options);
  await importEfbPackage(options.api, uploaded.packageVersionId, uploaded.paths, uploaded.alreadyValidated);
  const { revisionId, inspection } = await verifyEfbRelease(options.api, uploaded.packageVersionId);
  if (options.activate) await options.api({ action: "activate", revision: revisionId });
  return { dryRun: false, plan, revisionId, inspection, activated: options.activate === true };
}

export async function rollbackEfbRelease(api: PublisherApi, retainedRevisionId: string) {
  if (!retainedRevisionId) throw Error("efb_publisher_rollback_revision_required");
  return api({ action: "activate", revision: retainedRevisionId });
}

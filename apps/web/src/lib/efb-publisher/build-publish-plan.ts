import type { PublishPlan } from "./types.ts";

export function buildPublishPlan(packageVersionId: string, artifactCount: number, activate: boolean): PublishPlan {
  const steps: PublishPlan["steps"] = [
    { action: "initialize", detail: "Register signed manifest and artifact inventory", writesExternalState: true },
    { action: "upload", detail: `Upload ${artifactCount} immutable artifacts`, writesExternalState: true },
    { action: "validate", detail: "Validate artifacts in batches and import native entries", writesExternalState: true },
    { action: "complete", detail: "Complete retrieval and supporting-asset registration", writesExternalState: true },
    { action: "prepare", detail: "Create a candidate catalog release", writesExternalState: true },
    { action: "inspect", detail: "Verify candidate release inventory", writesExternalState: false },
  ];
  if (activate) steps.push({ action: "activate", detail: "Atomically activate the candidate revision", writesExternalState: true });
  return { packageVersionId, artifactCount, activate, steps };
}

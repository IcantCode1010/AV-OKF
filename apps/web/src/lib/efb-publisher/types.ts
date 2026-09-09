export type PublisherAction = "initialize" | "upload" | "validate" | "complete" | "prepare" | "inspect" | "activate";
export type PublishPlanStep = { action: PublisherAction; detail: string; writesExternalState: boolean };
export type PublishPlan = { packageVersionId: string; artifactCount: number; activate: boolean; steps: PublishPlanStep[] };
export type PublisherConfig = { endpoint: string; token: string };
export type PublisherApi = (body: Record<string, unknown>) => Promise<unknown>;

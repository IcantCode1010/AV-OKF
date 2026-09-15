import { z } from "zod";

export const operationProgressStatusSchema = z.enum([
  "queued",
  "running",
  "action_required",
  "completed",
  "completed_with_warnings",
  "failed",
  "cancelled",
]);

export const operationProgressSchema = z.object({
  action: z.object({ href: z.string().startsWith("/"), label: z.string().min(1) }).optional(),
  completed: z.number().int().nonnegative().optional(),
  currentItem: z.string().optional(),
  currentRound: z.number().int().nonnegative().optional(),
  detail: z.string(),
  heartbeatAt: z.string().datetime().optional(),
  id: z.string().min(1),
  kind: z.string().min(1),
  label: z.string().min(1),
  stage: z.string().min(1),
  status: operationProgressStatusSchema,
  total: z.number().int().nonnegative().optional(),
  totalRounds: z.number().int().positive().optional(),
  updatedAt: z.string().datetime(),
});

export const operationProgressSnapshotSchema = z.object({
  active: z.boolean(),
  data: z.unknown(),
  fingerprint: z.string(),
  generatedAt: z.string().datetime(),
  operations: z.array(operationProgressSchema),
});

export type OperationProgressStatus = z.infer<typeof operationProgressStatusSchema>;
export type OperationProgress = z.infer<typeof operationProgressSchema>;
export type OperationProgressSnapshot<T = unknown> = Omit<z.infer<typeof operationProgressSnapshotSchema>, "data"> & { data: T };

export function parseOperationProgressSnapshot<T>(value: unknown): OperationProgressSnapshot<T> | null {
  const parsed = operationProgressSnapshotSchema.safeParse(value);
  return parsed.success ? parsed.data as OperationProgressSnapshot<T> : null;
}

export function operationProgressBackoffMs(failureCount: number) {
  const boundedFailures = Math.max(1, Math.min(Math.floor(failureCount), 4));
  return Math.min(30_000, 2_000 * (2 ** boundedFailures));
}

export function shouldRefreshOperationProgressTerminal(input: {
  alreadyRefreshed: boolean;
  nextActive: boolean;
  previousActive: boolean;
}) {
  return !input.alreadyRefreshed && input.previousActive && !input.nextActive;
}

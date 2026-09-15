export type ActivityItem = {
  id: string;
  label: string;
  status: string;
  detail: string;
  href: string;
  startedAt: string;
  finishedAt?: string;
  completed?: number;
  total?: number;
  failed?: number;
  remainingSeconds?: number;
};
export type ActivitySnapshot = { items: ActivityItem[]; generatedAt: string };
export function estimateRemainingSeconds(
  durations: number[],
  remaining: number,
) {
  if (durations.length < 3 || remaining <= 0) return undefined;
  const sorted = [...durations].sort((a, b) => a - b);
  return Math.round((sorted[Math.floor(sorted.length / 2)] * remaining) / 1000);
}

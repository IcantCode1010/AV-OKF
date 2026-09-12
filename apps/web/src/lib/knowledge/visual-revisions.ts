export function activeArticleVisuals<
  T extends { id: string; provenance: unknown },
>(visuals: T[]): T[] {
  const replaced = new Set(
    visuals
      .map((v) => (v.provenance as { replacesId?: string } | null)?.replacesId)
      .filter(Boolean),
  );
  return visuals.filter((v) => !replaced.has(v.id));
}

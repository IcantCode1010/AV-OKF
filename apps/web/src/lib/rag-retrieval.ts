export type RankedChunk = {
  chunkId: string;
  score: number;
};

export function reciprocalRankFusion(
  rankings: RankedChunk[][],
  k = 60,
): RankedChunk[] {
  const scores = new Map<string, number>();

  for (const ranking of rankings) {
    ranking.forEach((item, index) => {
      scores.set(
        item.chunkId,
        (scores.get(item.chunkId) ?? 0) + 1 / (k + index + 1),
      );
    });
  }

  return [...scores.entries()]
    .map(([chunkId, score]) => ({ chunkId, score }))
    .sort(
      (left, right) =>
        right.score - left.score || left.chunkId.localeCompare(right.chunkId),
    );
}

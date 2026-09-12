export function buildTopicEnrichmentContextPageNumbers(input: {
  pageEnd: number;
  pageStart: number;
  radius?: number;
  sourcePageNumbers: number[];
}) {
  const radius = Math.max(0, Math.min(5, input.radius ?? 2));
  const anchors = [...new Set(input.sourcePageNumbers)]
    .filter((page) => Number.isInteger(page) && page > 0)
    .sort((left, right) => left - right);
  if (anchors.length === 0) {
    anchors.push(...[input.pageStart, input.pageEnd]
      .filter((page) => Number.isInteger(page) && page > 0));
  }
  const pages = new Set<number>();
  for (const anchor of anchors) {
    for (let page = Math.max(1, anchor - radius); page <= anchor + radius; page += 1) {
      pages.add(page);
    }
  }
  return [...pages].sort((left, right) => left - right);
}

export type ChatContentSegment =
  | { type: "text"; value: string }
  | { type: "citation"; index: number };

const CITATION_MARKER_PATTERN = /\[(\d+)\]/g;

export function parseCitationMarkers(content: string): ChatContentSegment[] {
  const segments: ChatContentSegment[] = [];
  let lastIndex = 0;

  for (const match of content.matchAll(CITATION_MARKER_PATTERN)) {
    const matchIndex = match.index ?? 0;

    if (matchIndex > lastIndex) {
      segments.push({ type: "text", value: content.slice(lastIndex, matchIndex) });
    }

    segments.push({ type: "citation", index: Number.parseInt(match[1]!, 10) });
    lastIndex = matchIndex + match[0].length;
  }

  if (lastIndex < content.length) {
    segments.push({ type: "text", value: content.slice(lastIndex) });
  }

  return segments;
}

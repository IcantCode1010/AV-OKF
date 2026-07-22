export type NormalizedOkfArticleBody = {
  body: string;
  removedLeadingTitleCount: number;
  removedTrailingSource: boolean;
};

export type OkfArticleReaderContent = NormalizedOkfArticleBody & {
  descriptionRepeatedExactly: boolean;
};

export function normalizeOkfArticleComparison(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeOkfArticleBody(input: {
  body: string;
  title: string;
}): NormalizedOkfArticleBody {
  const lines = input.body.replace(/\r\n?/g, "\n").split("\n");
  const normalizedTitle = normalizeOkfArticleComparison(input.title);
  let start = 0;
  let removedLeadingTitleCount = 0;

  skipBlankLines();
  while (start < lines.length) {
    const match = lines[start]!.match(/^#\s+(.+?)\s*$/);
    if (
      !match ||
      !normalizedTitle ||
      normalizeOkfArticleComparison(match[1] ?? "") !== normalizedTitle
    ) {
      break;
    }
    removedLeadingTitleCount += 1;
    start += 1;
    skipBlankLines();
  }

  let end = lines.length;
  while (end > start && !lines[end - 1]!.trim()) end -= 1;

  let removedTrailingSource = false;
  for (let index = end - 1; index >= start; index -= 1) {
    const match = lines[index]!.match(/^##\s+(.+?)\s*$/);
    if (!match) continue;
    if (normalizeOkfArticleComparison(match[1] ?? "") === "source") {
      end = index;
      removedTrailingSource = true;
    }
    break;
  }

  return {
    body: lines.slice(start, end).join("\n").trim(),
    removedLeadingTitleCount,
    removedTrailingSource,
  };

  function skipBlankLines() {
    while (start < lines.length && !lines[start]!.trim()) start += 1;
  }
}

export function buildOkfArticleReaderContent(input: {
  body: string;
  description: string | null;
  title: string;
}): OkfArticleReaderContent {
  const normalized = normalizeOkfArticleBody(input);
  const firstParagraph = getFirstProseParagraph(normalized.body);
  const normalizedDescription = input.description
    ? normalizeOkfArticleComparison(input.description)
    : "";

  return {
    ...normalized,
    descriptionRepeatedExactly: Boolean(
      normalizedDescription &&
      firstParagraph &&
      normalizeOkfArticleComparison(firstParagraph) === normalizedDescription,
    ),
  };
}

function getFirstProseParagraph(body: string) {
  const blocks = body.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
  for (const block of blocks) {
    const firstLine = block.split("\n", 1)[0]?.trim() ?? "";
    if (
      !firstLine ||
      /^#{1,6}\s/.test(firstLine) ||
      /^([-*+]|\d+\.)\s/.test(firstLine) ||
      /^(>|\||```)/.test(firstLine)
    ) {
      continue;
    }
    return block;
  }
  return "";
}

import type { ExtractedPageRecord, TopicConfidence } from "./document-vault.ts";

export type TopicCandidate = {
  documentId: string;
  title: string;
  topicType: string;
  summary: string;
  pageStart: number;
  pageEnd: number;
  confidence: TopicConfidence;
  sourcePageNumbers: number[];
};

type HeadingBoundary = {
  pageNumber: number;
  heading: string;
};

const FALLBACK_PAGE_RANGE_SIZE = 5;

export function generateTopicCandidates(
  documentId: string,
  pageRecords: ExtractedPageRecord[],
): TopicCandidate[] {
  const sortedPages = [...pageRecords].sort(
    (left, right) => left.pageNumber - right.pageNumber,
  );
  const ignoredHeadingLines = findRepeatedHeadingLines(sortedPages);
  const headings = dedupeConsecutiveHeadings(sortedPages
    .map((page) => ({
      pageNumber: page.pageNumber,
      heading: getHeadingCandidate(page.text, ignoredHeadingLines),
    }))
    .filter((heading): heading is HeadingBoundary => Boolean(heading.heading)));

  if (headings.length > 0) {
    return headings.map((heading, index) => {
      const nextHeading = headings[index + 1];
      const pageEnd = nextHeading
        ? previousAvailablePage(sortedPages, nextHeading.pageNumber)
        : sortedPages.at(-1)!.pageNumber;
      const sourcePageNumbers = pagesInRange(sortedPages, heading.pageNumber, pageEnd);

      return {
        documentId,
        title: heading.heading,
        topicType: inferTopicType(heading.heading),
        summary: summarizePages(sortedPages, sourcePageNumbers),
        pageStart: heading.pageNumber,
        pageEnd,
        confidence: "high",
        sourcePageNumbers,
      };
    });
  }

  const topics: TopicCandidate[] = [];
  for (let index = 0; index < sortedPages.length; index += FALLBACK_PAGE_RANGE_SIZE) {
    const group = sortedPages.slice(index, index + FALLBACK_PAGE_RANGE_SIZE);
    const pageStart = group[0]!.pageNumber;
    const pageEnd = group.at(-1)!.pageNumber;
    const sourcePageNumbers = group.map((page) => page.pageNumber);

    topics.push({
      documentId,
      title: pageStart === pageEnd ? `Page ${pageStart}` : `Pages ${pageStart}-${pageEnd}`,
      topicType: "coarse_range",
      summary: summarizePages(sortedPages, sourcePageNumbers),
      pageStart,
      pageEnd,
      confidence: "low",
      sourcePageNumbers,
    });
  }

  return topics;
}

function dedupeConsecutiveHeadings(headings: HeadingBoundary[]) {
  return headings.filter((heading, index) => {
    const previousHeading = headings[index - 1];
    return (
      !previousHeading ||
      normalizeLine(previousHeading.heading) !== normalizeLine(heading.heading)
    );
  });
}

function getHeadingCandidate(text: string, ignoredHeadingLines = new Set<string>()) {
  const candidateLines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8);

  for (const line of candidateLines) {
    const normalizedLine = normalizeLine(line);

    if (
      line.length > 90 ||
      ignoredHeadingLines.has(normalizedLine) ||
      isNonHeadingLine(line)
    ) {
      continue;
    }

    const words = line.split(/\s+/);
    const upperLetters = line.replace(/[^A-Z]/g, "").length;
    const lowerLetters = line.replace(/[^a-z]/g, "").length;
    const allCapsLike =
      upperLetters > 0 && lowerLetters <= Math.max(1, upperLetters * 0.15);
    const numberedHeading = /^(ATA|CHAPTER|SECTION|TASK|\d+(\.\d+)*\b)/i.test(
      line,
    );
    const shortTitle = words.length <= 8 && !/[.!?]$/.test(line);

    if (allCapsLike || numberedHeading || shortTitle) {
      return line;
    }
  }

  return null;
}

function findRepeatedHeadingLines(pages: ExtractedPageRecord[]) {
  const counts = new Map<string, number>();
  const minimumRepeatCount = Math.min(3, pages.length);

  for (const page of pages) {
    const uniqueLines = new Set(
      page.text
        .split(/\r?\n/)
        .map((line) => normalizeLine(line))
        .filter((line) => line.length > 0 && line.length <= 90)
        .slice(0, 8),
    );

    for (const line of uniqueLines) {
      counts.set(line, (counts.get(line) ?? 0) + 1);
    }
  }

  return new Set(
    [...counts.entries()]
      .filter(([, count]) => count >= minimumRepeatCount)
      .map(([line]) => line),
  );
}

function normalizeLine(line: string) {
  return line.replace(/\s+/g, " ").trim().toLowerCase();
}

function isNonHeadingLine(line: string) {
  return (
    /^page\s+\d+$/i.test(line) ||
    /^effective\s+on:/i.test(line) ||
    /^(description|general)$/i.test(line)
  );
}

function previousAvailablePage(pages: ExtractedPageRecord[], beforePage: number) {
  const previous = [...pages]
    .reverse()
    .find((page) => page.pageNumber < beforePage);
  return previous?.pageNumber ?? beforePage - 1;
}

function pagesInRange(
  pages: ExtractedPageRecord[],
  pageStart: number,
  pageEnd: number,
) {
  return pages
    .filter((page) => page.pageNumber >= pageStart && page.pageNumber <= pageEnd)
    .map((page) => page.pageNumber);
}

function summarizePages(pages: ExtractedPageRecord[], sourcePageNumbers: number[]) {
  const joined = pages
    .filter((page) => sourcePageNumbers.includes(page.pageNumber))
    .map((page) => page.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  if (joined.length <= 180) {
    return joined || "No selectable text was available for this topic.";
  }

  return `${joined.slice(0, 177).trim()}...`;
}

function inferTopicType(title: string) {
  const normalized = title.toLowerCase();

  if (normalized.includes("fault")) {
    return "fault_isolation";
  }

  if (normalized.includes("procedure") || normalized.includes("task")) {
    return "procedure";
  }

  if (normalized.includes("ata")) {
    return "manual_section";
  }

  return "document_section";
}

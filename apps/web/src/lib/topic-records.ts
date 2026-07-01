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
  const headings = sortedPages
    .map((page) => ({
      pageNumber: page.pageNumber,
      heading: getHeadingCandidate(page.text),
    }))
    .filter((heading): heading is HeadingBoundary => Boolean(heading.heading));

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

function getHeadingCandidate(text: string) {
  const firstLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  if (!firstLine || firstLine.length > 90) {
    return null;
  }

  const words = firstLine.split(/\s+/);
  const upperLetters = firstLine.replace(/[^A-Z]/g, "").length;
  const lowerLetters = firstLine.replace(/[^a-z]/g, "").length;
  const allCapsLike = upperLetters > 0 && lowerLetters <= Math.max(1, upperLetters * 0.15);
  const numberedHeading = /^(ATA|CHAPTER|SECTION|TASK|\d+(\.\d+)*\b)/i.test(firstLine);
  const shortTitle = words.length <= 8 && !/[.!?]$/.test(firstLine);

  if (allCapsLike || numberedHeading || shortTitle) {
    return firstLine;
  }

  return null;
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

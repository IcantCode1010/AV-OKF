import { createHash } from "node:crypto";

import { normalizeOkfArticleBody } from "./okf-article-content.ts";
import { parseOkfMarkdown } from "./okf-frontmatter.ts";

export type OkfArticleRepairCandidate = {
  approvalMode: string | null;
  enrichedBody: string | null;
  exportedFilePath: string;
  exportedMarkdown: string | null;
  relations: unknown;
  reviewStatus: string;
  sourcePageNumbers: number[];
  summary: string;
  title: string;
  topicId: string;
};

export type OkfArticleRepairItem = {
  exportedFile: {
    beforeHash: string | null;
    hasCanonicalSource: boolean;
    leadingMatchingTitleCount: number;
    missing: boolean;
    needsReExport: boolean;
  };
  exportedFilePath: string;
  preserved: {
    approval: true;
    relations: true;
    sourcePages: true;
    summary: true;
    title: true;
  };
  requiresChange: boolean;
  storedBody: {
    afterExcerpt: string;
    afterHash: string;
    beforeExcerpt: string;
    beforeHash: string;
    changed: boolean;
    removedLeadingTitleCount: number;
    removedTrailingSource: boolean;
  };
  title: string;
  topicId: string;
};

export type OkfArticleRepairReport = {
  bundleId: string;
  changedCount: number;
  itemCount: number;
  items: OkfArticleRepairItem[];
  reportHash: string;
  workspaceId: string;
};

const EXCERPT_LIMIT = 500;

export function buildOkfArticleRepairReport(input: {
  bundleId: string;
  candidates: OkfArticleRepairCandidate[];
  workspaceId: string;
}): OkfArticleRepairReport {
  const items = input.candidates
    .map(buildRepairItem)
    .sort((left, right) =>
      left.exportedFilePath.localeCompare(right.exportedFilePath) ||
      left.topicId.localeCompare(right.topicId),
    );
  const payload = {
    bundleId: input.bundleId,
    items,
    workspaceId: input.workspaceId,
  };
  return {
    ...payload,
    changedCount: items.filter((item) => item.requiresChange).length,
    itemCount: items.length,
    reportHash: hashValue(JSON.stringify(payload)),
  };
}

export function assertOkfArticleRepairAcknowledgement(
  report: OkfArticleRepairReport,
  acknowledgement: string | undefined,
) {
  if (!acknowledgement || acknowledgement !== report.reportHash) {
    throw new Error(
      `okf_article_repair_requires_matching_acknowledgement:${report.reportHash}`,
    );
  }
}

export function getRepairedEnrichedBody(candidate: OkfArticleRepairCandidate) {
  if (!candidate.enrichedBody) return candidate.enrichedBody;
  return normalizeOkfArticleBody({
    body: candidate.enrichedBody,
    title: candidate.title,
  }).body || candidate.summary;
}

function buildRepairItem(candidate: OkfArticleRepairCandidate): OkfArticleRepairItem {
  const beforeBody = candidate.enrichedBody ?? "";
  const normalizedBody = normalizeOkfArticleBody({
    body: beforeBody,
    title: candidate.title,
  });
  const afterBody = beforeBody
    ? normalizedBody.body || candidate.summary
    : beforeBody;
  const exportedFraming = inspectExportedFraming(
    candidate.exportedMarkdown,
    candidate.title,
  );
  const storedBodyChanged = beforeBody !== afterBody;

  return {
    exportedFile: exportedFraming,
    exportedFilePath: candidate.exportedFilePath,
    preserved: {
      approval: true,
      relations: true,
      sourcePages: true,
      summary: true,
      title: true,
    },
    requiresChange: storedBodyChanged || exportedFraming.needsReExport,
    storedBody: {
      afterExcerpt: excerpt(afterBody),
      afterHash: hashValue(afterBody),
      beforeExcerpt: excerpt(beforeBody),
      beforeHash: hashValue(beforeBody),
      changed: storedBodyChanged,
      removedLeadingTitleCount: normalizedBody.removedLeadingTitleCount,
      removedTrailingSource: normalizedBody.removedTrailingSource,
    },
    title: candidate.title,
    topicId: candidate.topicId,
  };
}

function inspectExportedFraming(
  markdown: string | null,
  title: string,
): OkfArticleRepairItem["exportedFile"] {
  if (markdown === null) {
    return {
      beforeHash: null,
      hasCanonicalSource: false,
      leadingMatchingTitleCount: 0,
      missing: true,
      needsReExport: true,
    };
  }

  let body = markdown;
  try {
    body = parseOkfMarkdown(markdown).body;
  } catch {
    return {
      beforeHash: hashValue(markdown),
      hasCanonicalSource: false,
      leadingMatchingTitleCount: 0,
      missing: false,
      needsReExport: true,
    };
  }

  const normalized = normalizeOkfArticleBody({ body, title });
  const hasCanonicalSource = normalized.removedTrailingSource;
  const leadingMatchingTitleCount = normalized.removedLeadingTitleCount;
  return {
    beforeHash: hashValue(markdown),
    hasCanonicalSource,
    leadingMatchingTitleCount,
    missing: false,
    needsReExport: leadingMatchingTitleCount !== 1 || !hasCanonicalSource,
  };
}

function excerpt(value: string) {
  return value.length <= EXCERPT_LIMIT
    ? value
    : `${value.slice(0, EXCERPT_LIMIT)}\n...[truncated]`;
}

function hashValue(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

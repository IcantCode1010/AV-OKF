import path from "node:path";

import type { OkfExplorerFile } from "./okf-explorer.ts";
import { formatRelationLabel, RELATION_DEFINITIONS } from "./okf-relation-definitions.ts";
import type { getOkfRelationReviewQueue } from "./okf-relation-discovery.ts";

export { formatRelationLabel, humanizeRelationFailure } from "./okf-relation-definitions.ts";

type QueueCandidate = Awaited<ReturnType<typeof getOkfRelationReviewQueue>>["actionable"][number];

export type OkfRelationReviewConcept = {
  available: boolean;
  description: string | null;
  filePath: string;
  sourceDocument: string | null;
  title: string;
  type: string;
};

export type OkfRelationReviewItem = {
  automaticApprovalError: string | null;
  automaticApprovalRequested: boolean;
  confidence: number | null;
  direction: "proposed" | "reverse";
  evidenceQuote: string | null;
  id: string;
  initialProposal: string;
  model: string | null;
  provider: string | null;
  publishedReview: boolean;
  publishedReviewStatus: string | null;
  rationale: string | null;
  relation: string;
  relationDefinition: string;
  relationLabel: string;
  reviewable: boolean;
  sentence: string;
  signals: string[];
  source: OkfRelationReviewConcept;
  status: string;
  target: OkfRelationReviewConcept;
  verificationError: string | null;
  verificationStatus: string;
  warnings: string[];
};

export function buildOkfRelationReviewItems(input: {
  candidates: QueueCandidate[];
  files: OkfExplorerFile[];
}): OkfRelationReviewItem[] {
  const fileByPath = new Map(input.files.map((file) => [file.filename, file]));

  return input.candidates.map((candidate) => {
    const publishedReview = candidate.status === "approved" && candidate.publishedReviewStatus !== null;
    const reverse = !publishedReview && candidate.verificationDirection === "reverse";
    const sourcePath = publishedReview && candidate.publishedSourceFile
      ? candidate.publishedSourceFile
      : reverse ? candidate.targetFile : candidate.sourceFile;
    const targetPath = publishedReview && candidate.publishedTargetFile
      ? candidate.publishedTargetFile
      : reverse ? candidate.sourceFile : candidate.targetFile;
    const source = buildConcept(sourcePath, fileByPath.get(sourcePath));
    const target = buildConcept(targetPath, fileByPath.get(targetPath));
    const relation = publishedReview
      ? candidate.publishedRelation ?? candidate.verificationRelation ?? candidate.relation
      : candidate.verificationRelation ?? candidate.relation;
    const relationLabel = formatRelationLabel(relation);
    const signals = Array.isArray(candidate.signals)
      ? candidate.signals.filter((signal): signal is string => typeof signal === "string")
      : [];

    return {
      automaticApprovalError: candidate.automaticApprovalError,
      automaticApprovalRequested: candidate.automaticApprovalRequested,
      confidence: candidate.verificationConfidence,
      direction: reverse ? "reverse" : "proposed",
      evidenceQuote: candidate.verificationEvidenceQuote,
      id: candidate.id,
      initialProposal: candidate.reason,
      model: candidate.verificationModel,
      provider: candidate.verificationProvider,
      publishedReview,
      publishedReviewStatus: candidate.publishedReviewStatus,
      rationale: candidate.verificationRationale,
      relation,
      relationDefinition: RELATION_DEFINITIONS[relation] ?? "The source concept has a verified relationship to the target concept.",
      relationLabel,
      reviewable: source.available && target.available,
      sentence: `${source.title} ${relationLabel.toLowerCase()} ${target.title}.`,
      signals,
      source,
      status: candidate.status,
      target,
      verificationError: candidate.verificationError,
      verificationStatus: candidate.verificationStatus,
      warnings: signals
        .filter((signal) => signal.startsWith("preflight_warning:"))
        .map((warning) => humanizeCode(warning.slice("preflight_warning:".length))),
    };
  });
}

function buildConcept(filePath: string, file: OkfExplorerFile | undefined): OkfRelationReviewConcept {
  if (!file || file.isReserved || !file.isParseable) {
    return {
      available: false,
      description: null,
      filePath,
      sourceDocument: null,
      title: humanizeFilePath(filePath),
      type: "Unavailable concept",
    };
  }

  return {
    available: true,
    description: file.description,
    filePath,
    sourceDocument: file.sourceFile,
    title: file.title,
    type: formatRelationLabel(file.type),
  };
}

function humanizeFilePath(filePath: string) {
  const basename = path.posix.basename(filePath.replaceAll("\\", "/"), ".md");
  const withoutHash = basename.replace(/-[a-f0-9]{8,}$/i, "");
  const words = withoutHash.replaceAll(/[-_]+/g, " ").trim();
  if (!words) return "Unavailable concept";
  return words.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function humanizeCode(value: string) {
  return value.replaceAll("_", " ").replaceAll(":", ": ").replaceAll(/\s+/g, " ").trim();
}

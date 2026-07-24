import path from "node:path";

import type { AuthWorkspaceContext } from "./auth-workspace.ts";
import {
  getFrontmatterNumberArray,
  getFrontmatterScalar,
  parseOkfMarkdown,
} from "./okf-frontmatter.ts";
import { isAgentReadyOkfMetadata } from "./okf-generic-metadata.ts";
import {
  getKnowledgeBundle,
  resolveKnowledgeBundleRoot,
  type KnowledgeBundleRecord,
} from "./knowledge-bundles.ts";
import { listOkfBundleFiles, readOkfBundleFile } from "./okf-bundle.ts";
import { getOkfConceptLifecycleByFile } from "./okf-lifecycle.ts";
import { buildOkfArticleReaderContent } from "./okf-article-content.ts";
import { normalizeOkfTopicFilePath } from "./okf-topic-routing.ts";
import { getPrisma } from "./prisma.ts";

export type ApprovedOkfTopicView = {
  approvalProvenance: "automated" | "human" | "legacy";
  approvedAt: string | null;
  approvedFilePaths: string[];
  body: string;
  bundleId: string;
  bundleName: string;
  description: string | null;
  descriptionRepeatedExactly: boolean;
  filePath: string;
  sourceFile: string;
  sourcePages: number[];
  sourceDocument: ApprovedOkfTopicSourceDocument | null;
  title: string;
  type: string;
  updated: string | null;
};

export type ApprovedOkfTopicSourceDocument = {
  documentHref: string;
  id: string;
  pdfHref: string | null;
  title: string;
};

type TopicViewDependencies = {
  getBundle?: typeof getKnowledgeBundle;
  getLifecycles?: typeof getOkfConceptLifecycleByFile;
  listFiles?: typeof listOkfBundleFiles;
  readFile?: typeof readOkfBundleFile;
  resolveSourceDocument?: typeof resolveApprovedOkfTopicSourceDocument;
};

export async function loadApprovedOkfTopicView(input: {
  bundleId: string;
  context: AuthWorkspaceContext;
  filePath: string;
  knowledgeRoot?: string;
}, dependencies: TopicViewDependencies = {}): Promise<ApprovedOkfTopicView | null> {
  const getBundle = dependencies.getBundle ?? getKnowledgeBundle;
  const listFiles = dependencies.listFiles ?? listOkfBundleFiles;
  const readFile = dependencies.readFile ?? readOkfBundleFile;
  const bundle = await getBundle({ bundleId: input.bundleId, context: input.context });

  if (!bundle) return null;

  const normalizedFilePath = normalizeOkfTopicFilePath(input.filePath);
  if (!normalizedFilePath) return null;

  const knowledgeRoot = input.knowledgeRoot ?? resolveKnowledgeBundleRoot({
    bundleId: bundle.id,
    workspaceId: input.context.workspaceId,
  });

  try {
    const files = await listFiles(knowledgeRoot);
    const selected = files.find((file) => file.filename === normalizedFilePath);
    if (!selected || selected.isReserved) return null;

    const lifecycleByFile = await loadLifecycleMap({
      bundle,
      context: input.context,
      dependencies,
      filePaths: files.map((file) => file.filename),
    });
    if ((lifecycleByFile.get(selected.filename)?.status ?? "active") !== "active") {
      return null;
    }

    const parsedByFile = new Map<string, ReturnType<typeof parseOkfMarkdown>>();
    const readAndParse = async (filePath: string) => {
      const existing = parsedByFile.get(filePath);
      if (existing) return existing;
      const content = await readFile(knowledgeRoot, filePath);
      const parsed = parseOkfMarkdown(content.content);
      parsedByFile.set(filePath, parsed);
      return parsed;
    };

    const parsed = await readAndParse(selected.filename);
    if (!isAgentReadyOkfMetadata(parsed.frontmatter, parsed.body)) return null;

    const approvedFilePaths = (await Promise.all(files.map(async (file) => {
      if (file.isReserved || (lifecycleByFile.get(file.filename)?.status ?? "active") !== "active") {
        return null;
      }
      try {
        const candidate = await readAndParse(file.filename);
        return isAgentReadyOkfMetadata(candidate.frontmatter, candidate.body)
          ? file.filename
          : null;
      } catch {
        return null;
      }
    }))).filter((filePath): filePath is string => Boolean(filePath)).sort();

    return buildApprovedTopicView({
      bundle,
      filePath: selected.filename,
      parsed,
      approvedFilePaths,
      sourceDocument: await (dependencies.resolveSourceDocument ?? resolveApprovedOkfTopicSourceDocument)({
        bundleId: bundle.id,
        filePath: selected.filename,
        pageStart: getFrontmatterNumberArray(parsed.frontmatter, "source_pages")[0] ?? null,
        workspaceId: input.context.workspaceId,
      }),
    });
  } catch {
    return null;
  }
}

export function resolveApprovedOkfTopicLink(input: {
  approvedFilePaths: string[];
  href: string | undefined;
  sourceFile: string;
}):
  | { kind: "broken" }
  | { kind: "external" }
  | { filePath: string; kind: "internal" } {
  const href = input.href?.trim();
  if (!href) return { kind: "broken" };
  if (/^https?:\/\//i.test(href)) return { kind: "external" };
  if (href.startsWith("//") || href.startsWith("/") || href.includes("\\") || href.includes("?")) {
    return { kind: "broken" };
  }

  const [rawPath] = href.split("#");
  if (!rawPath?.endsWith(".md")) return { kind: "broken" };

  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return { kind: "broken" };
  }

  const normalized = path.posix.normalize(
    path.posix.join(path.posix.dirname(input.sourceFile), decoded),
  );
  if (
    normalized === ".." ||
    normalized.startsWith("../") ||
    path.posix.isAbsolute(normalized) ||
    !input.approvedFilePaths.includes(normalized)
  ) {
    return { kind: "broken" };
  }

  return { filePath: normalized, kind: "internal" };
}

function buildApprovedTopicView(input: {
  approvedFilePaths: string[];
  bundle: KnowledgeBundleRecord;
  filePath: string;
  parsed: ReturnType<typeof parseOkfMarkdown>;
  sourceDocument: ApprovedOkfTopicSourceDocument | null;
}): ApprovedOkfTopicView {
  const approvedBy = getFrontmatterScalar(input.parsed.frontmatter, "approved_by");
  const title = getFrontmatterScalar(input.parsed.frontmatter, "title")!;
  const description = getFrontmatterScalar(input.parsed.frontmatter, "description");
  const readerContent = buildOkfArticleReaderContent({
    body: input.parsed.body,
    description,
    title,
  });
  return {
    approvalProvenance: approvedBy === null
      ? "legacy"
      : approvedBy.startsWith("automation:")
        ? "automated"
        : "human",
    approvedAt: getFrontmatterScalar(input.parsed.frontmatter, "approved_at"),
    approvedFilePaths: input.approvedFilePaths,
    body: readerContent.body,
    bundleId: input.bundle.id,
    bundleName: input.bundle.name,
    description,
    descriptionRepeatedExactly: readerContent.descriptionRepeatedExactly,
    filePath: input.filePath,
    sourceFile: getFrontmatterScalar(input.parsed.frontmatter, "source_file")!,
    sourcePages: getFrontmatterNumberArray(input.parsed.frontmatter, "source_pages"),
    sourceDocument: input.sourceDocument,
    title,
    type: getFrontmatterScalar(input.parsed.frontmatter, "type")!,
    updated: getFrontmatterScalar(input.parsed.frontmatter, "updated"),
  };
}

export async function resolveApprovedOkfTopicSourceDocument(input: {
  bundleId: string;
  filePath: string;
  pageStart: number | null;
  workspaceId: string;
}, dependencies: {
  backend?: string;
  prisma?: Pick<ReturnType<typeof getPrisma>, "topicRecord">;
} = {}): Promise<ApprovedOkfTopicSourceDocument | null> {
  const normalizedFilePath = normalizeOkfTopicFilePath(input.filePath);
  if (!normalizedFilePath || normalizedFilePath !== input.filePath) return null;
  if ((dependencies.backend ?? process.env.AV_OKF_BACKEND) !== "production") return null;

  const prisma = dependencies.prisma ?? getPrisma();
  const topic = await prisma.topicRecord.findFirst({
    select: {
      document: {
        select: {
          id: true,
          knowledgeBundleId: true,
          objects: {
            orderBy: { createdAt: "asc" },
            select: { kind: true },
            where: { kind: "original_pdf" },
          },
          title: true,
        },
      },
    },
    where: {
      exportedFilePath: normalizedFilePath,
      knowledgeBundleId: input.bundleId,
      reviewStatus: "approved",
      workspaceId: input.workspaceId,
      document: {
        deletedAt: null,
        knowledgeBundleId: input.bundleId,
        workspaceId: input.workspaceId,
      },
    },
  });

  const document = topic?.document;
  if (!document || document.knowledgeBundleId !== input.bundleId) return null;

  const encodedDocumentId = encodeURIComponent(document.id);
  const pageFragment = input.pageStart && input.pageStart > 0
    ? `#page=${input.pageStart}`
    : "";

  return {
    documentHref: `/documents/${encodedDocumentId}`,
    id: document.id,
    pdfHref: document.objects.length > 0
      ? `/api/documents/${encodedDocumentId}/file${pageFragment}`
      : null,
    title: document.title,
  };
}

async function loadLifecycleMap(input: {
  bundle: KnowledgeBundleRecord;
  context: AuthWorkspaceContext;
  dependencies: TopicViewDependencies;
  filePaths: string[];
}) {
  if (input.dependencies.getLifecycles) {
    return input.dependencies.getLifecycles({
      filePaths: input.filePaths,
      knowledgeBundleId: input.bundle.id,
      workspaceId: input.context.workspaceId,
    });
  }
  if (process.env.AV_OKF_BACKEND !== "production") return new Map();
  return getOkfConceptLifecycleByFile({
    filePaths: input.filePaths,
    knowledgeBundleId: input.bundle.id,
    workspaceId: input.context.workspaceId,
  });
}

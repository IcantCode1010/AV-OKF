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
  title: string;
  type: string;
  updated: string | null;
};

type TopicViewDependencies = {
  getBundle?: typeof getKnowledgeBundle;
  getLifecycles?: typeof getOkfConceptLifecycleByFile;
  listFiles?: typeof listOkfBundleFiles;
  readFile?: typeof readOkfBundleFile;
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

  const knowledgeRoot = input.knowledgeRoot ?? resolveKnowledgeBundleRoot({
    bundleId: bundle.id,
    workspaceId: input.context.workspaceId,
  });

  try {
    const files = await listFiles(knowledgeRoot);
    const selected = files.find((file) => file.filename === input.filePath);
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
    title,
    type: getFrontmatterScalar(input.parsed.frontmatter, "type")!,
    updated: getFrontmatterScalar(input.parsed.frontmatter, "updated"),
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

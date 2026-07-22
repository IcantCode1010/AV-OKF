import path from "node:path";

import {
  getFrontmatterNumberArray,
  getFrontmatterRelations,
  getFrontmatterScalar,
  parseOkfMarkdown,
} from "./okf-frontmatter.ts";
import { getAllowedRelations } from "./okf-relation-vocabulary.ts";
import { resolveKnowledgePath } from "./knowledge-root.ts";
import {
  listOkfBundleFiles,
  readOkfBundleFile,
  type OkfBundleFile,
} from "./okf-bundle.ts";
import { getOkfConceptLifecycleByFile } from "./okf-lifecycle.ts";
import type { OkfConceptLifecycleRecord } from "./okf-bundle-retriever.ts";
import { isAgentReadyOkfMetadata, validateGenericOkfMetadata } from "./okf-generic-metadata.ts";
import { buildOkfArticleReaderContent } from "./okf-article-content.ts";

export type OkfExplorerNode = {
  degree: number;
  id: string;
  reviewStatus: string;
  sourceFile: string | null;
  sourcePages: number[];
  title: string;
  type: string;
};

export type OkfExplorerEdge = {
  id: string;
  reason: string;
  relation: string;
  source: string;
  target: string;
};

export type OkfExplorerBacklink = {
  reason: string;
  relation: string;
  sourceFile: string;
  sourceTitle: string;
};

export type OkfExplorerFile = {
  body: string;
  description: string | null;
  descriptionRepeatedExactly: boolean;
  filename: string;
  isParseable: boolean;
  isReserved: boolean;
  lifecycleStatus: "active";
  reviewStatus: string;
  sourceFile: string | null;
  sourcePages: number[];
  title: string;
  trustStatus: "agent_ready" | "generic_valid" | "invalid_generic" | "missing_trust_metadata" | "reserved";
  type: string;
};

export type OkfTreeNode = {
  children: OkfTreeNode[];
  id: string;
  kind: "directory" | "file";
  label: string;
};

export type OkfExplorerIssue = {
  code:
    | "file_unparseable"
    | "relation_reason_required"
    | "relation_target_inactive"
    | "relation_target_invalid"
    | "relation_target_missing"
    | "relation_target_type_mismatch"
    | "relation_type_not_allowed";
  file: string;
  message: string;
  relationIndex?: number;
};

export type OkfExplorerDocument = OkfExplorerFile & {
  incoming: OkfExplorerBacklink[];
  outgoing: OkfExplorerEdge[];
};

export type OkfExplorerSnapshot = {
  defaultFile: string | null;
  edges: OkfExplorerEdge[];
  files: OkfExplorerFile[];
  issues: OkfExplorerIssue[];
  nodes: OkfExplorerNode[];
  selectedDocument: OkfExplorerDocument | null;
  selectedFile: string | null;
  tree: OkfTreeNode[];
};

type BuildExplorerInput = {
  allowedRelations?: string[];
  bundleFiles?: OkfBundleFile[];
  knowledgeRoot: string;
  lifecycleByFile?: Map<string, OkfConceptLifecycleRecord>;
  requestedFile?: string;
};

export async function loadOkfExplorerSnapshot(input: {
  knowledgeBundleId: string;
  knowledgeRoot: string;
  requestedFile?: string;
  workspaceId: string;
}): Promise<OkfExplorerSnapshot> {
  let bundleFiles: OkfBundleFile[];

  try {
    bundleFiles = await listOkfBundleFiles(input.knowledgeRoot);
  } catch (error) {
    if (isMissingPathError(error)) {
      bundleFiles = [];
    } else {
      throw error;
    }
  }

  const lifecycleByFile =
    process.env.AV_OKF_BACKEND === "production"
      ? await getOkfConceptLifecycleByFile({
          filePaths: bundleFiles.map((file) => file.filename),
          knowledgeBundleId: input.knowledgeBundleId,
          workspaceId: input.workspaceId,
        })
      : new Map<string, OkfConceptLifecycleRecord>();

  return buildOkfExplorerSnapshot({
    bundleFiles,
    knowledgeRoot: input.knowledgeRoot,
    lifecycleByFile,
    requestedFile: input.requestedFile,
  });
}

export async function buildOkfExplorerSnapshot(
  input: BuildExplorerInput,
): Promise<OkfExplorerSnapshot> {
  const bundleFiles = input.bundleFiles ?? (await listOkfBundleFiles(input.knowledgeRoot));
  const lifecycleByFile = input.lifecycleByFile ?? new Map();
  const activeBundleFiles = bundleFiles.filter(
    (file) => (lifecycleByFile.get(file.filename)?.status ?? "active") === "active",
  );
  const activePaths = new Set(activeBundleFiles.map((file) => file.filename));
  const inactivePaths = new Set(
    bundleFiles
      .filter((file) => !activePaths.has(file.filename))
      .map((file) => file.filename),
  );
  const issues: OkfExplorerIssue[] = [];
  const files = await Promise.all(
    activeBundleFiles.map(async (file) => {
      const content = await readOkfBundleFile(input.knowledgeRoot, file.filename);
      const parsed = parseOkfMarkdown(content.content);
      const title = getFrontmatterScalar(parsed.frontmatter, "title");
      const type = getFrontmatterScalar(parsed.frontmatter, "type");
      const description = getFrontmatterScalar(parsed.frontmatter, "description");
      const readerContent = file.isReserved
        ? { body: parsed.body, descriptionRepeatedExactly: false }
        : buildOkfArticleReaderContent({
            body: parsed.body,
            description,
            title: title ?? file.title,
          });
      const isParseable = file.isReserved || Boolean(title && type);
      const genericValidation = validateGenericOkfMetadata(parsed.frontmatter);
      const hasAnyTrustMetadata = ["review_status", "source_file", "source_pages"].some(
        (field) => parsed.frontmatter[field] !== undefined,
      );
      const trustStatus = file.isReserved
        ? "reserved" as const
        : !genericValidation.valid
          ? "invalid_generic" as const
          : isAgentReadyOkfMetadata(parsed.frontmatter, parsed.body)
            ? "agent_ready" as const
            : hasAnyTrustMetadata
              ? "missing_trust_metadata" as const
              : "generic_valid" as const;

      if (!isParseable) {
        issues.push({
          code: "file_unparseable",
          file: file.filename,
          message: "The file is visible in the tree but lacks a parseable title or type.",
        });
      }

      return {
        body: readerContent.body,
        description,
        descriptionRepeatedExactly: readerContent.descriptionRepeatedExactly,
        filename: file.filename,
        isParseable,
        isReserved: file.isReserved,
        lifecycleStatus: "active" as const,
        reviewStatus:
          getFrontmatterScalar(parsed.frontmatter, "review_status") ?? "unknown",
        sourceFile: getFrontmatterScalar(parsed.frontmatter, "source_file"),
        sourcePages: getFrontmatterNumberArray(parsed.frontmatter, "source_pages"),
        title: title ?? file.title,
        trustStatus,
        type: type ?? file.type,
        relations: getFrontmatterRelations(parsed.frontmatter),
      };
    }),
  );
  const fileByPath = new Map(files.map((file) => [file.filename, file]));
  const allowedRelations = new Set(
    input.allowedRelations ?? (await getAllowedRelations()),
  );
  const edges: OkfExplorerEdge[] = [];

  for (const file of files) {
    if (file.isReserved || !file.isParseable) {
      continue;
    }

    for (const [relationIndex, relation] of file.relations.entries()) {
      const issue = await validateExplorerRelation({
        activePaths,
        allowedRelations,
        file,
        fileByPath,
        inactivePaths,
        knowledgeRoot: input.knowledgeRoot,
        relation,
        relationIndex,
      });

      if (issue) {
        issues.push(issue);
        continue;
      }

      const target = resolveRelationPath(file.filename, relation.target)!;
      edges.push({
        id: `${file.filename}::${relationIndex}::${target}`,
        reason: relation.reason.trim(),
        relation: relation.relation,
        source: file.filename,
        target,
      });
    }
  }

  edges.sort(compareEdges);
  const nodes = files
    .filter((file) => !file.isReserved && file.isParseable)
    .map<OkfExplorerNode>((file) => ({
      degree: edges.filter(
        (edge) => edge.source === file.filename || edge.target === file.filename,
      ).length,
      id: file.filename,
      reviewStatus: file.reviewStatus,
      sourceFile: file.sourceFile,
      sourcePages: file.sourcePages,
      title: file.title,
      type: file.type,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const orderedFiles: OkfExplorerFile[] = files
    .map((file) => ({
      body: file.body,
      description: file.description,
      descriptionRepeatedExactly: file.descriptionRepeatedExactly,
      filename: file.filename,
      isParseable: file.isParseable,
      isReserved: file.isReserved,
      lifecycleStatus: file.lifecycleStatus,
      reviewStatus: file.reviewStatus,
      sourceFile: file.sourceFile,
      sourcePages: file.sourcePages,
      title: file.title,
      trustStatus: file.trustStatus,
      type: file.type,
    }))
    .sort((left, right) => left.filename.localeCompare(right.filename));
  const defaultFile = getDefaultFile(orderedFiles, nodes);
  const selectedFile = getSelectedFile(
    orderedFiles,
    defaultFile,
    input.requestedFile,
  );
  const selected = selectedFile
    ? orderedFiles.find((file) => file.filename === selectedFile) ?? null
    : null;
  const selectedDocument = selected
    ? {
        ...selected,
        incoming: getBacklinks(selected.filename, edges, fileByPath),
        outgoing: edges.filter((edge) => edge.source === selected.filename),
      }
    : null;

  return {
    defaultFile,
    edges,
    files: orderedFiles,
    issues: issues.sort(compareIssues),
    nodes,
    selectedDocument,
    selectedFile,
    tree: buildPhysicalTree(orderedFiles),
  };
}

export function buildPhysicalTree(files: Pick<OkfExplorerFile, "filename">[]): OkfTreeNode[] {
  const root: OkfTreeNode = { children: [], id: "", kind: "directory", label: "" };

  for (const file of [...files].sort((a, b) => a.filename.localeCompare(b.filename))) {
    const parts = file.filename.split("/").filter(Boolean);
    let parent = root;

    for (const [index, part] of parts.entries()) {
      const id = parts.slice(0, index + 1).join("/");
      const kind = index === parts.length - 1 ? "file" : "directory";
      let child = parent.children.find((entry) => entry.id === id);

      if (!child) {
        child = { children: [], id, kind, label: part };
        parent.children.push(child);
      }

      parent = child;
    }
  }

  sortTree(root.children);
  return root.children;
}

async function validateExplorerRelation(input: {
  activePaths: Set<string>;
  allowedRelations: Set<string>;
  file: OkfExplorerFile & { relations: ReturnType<typeof getFrontmatterRelations> };
  fileByPath: Map<string, OkfExplorerFile & { relations: ReturnType<typeof getFrontmatterRelations> }>;
  inactivePaths: Set<string>;
  knowledgeRoot: string;
  relation: ReturnType<typeof getFrontmatterRelations>[number];
  relationIndex: number;
}): Promise<OkfExplorerIssue | null> {
  const base = { file: input.file.filename, relationIndex: input.relationIndex };

  if (!input.allowedRelations.has(input.relation.relation)) {
    return {
      ...base,
      code: "relation_type_not_allowed",
      message: `Relation type '${input.relation.relation}' is not allowed.`,
    };
  }

  if (!input.relation.reason.trim()) {
    return {
      ...base,
      code: "relation_reason_required",
      message: "Relation reason is required.",
    };
  }

  const target = resolveRelationPath(input.file.filename, input.relation.target);
  if (!target) {
    return {
      ...base,
      code: "relation_target_invalid",
      message: `Relation target '${input.relation.target}' is unsafe or unsupported.`,
    };
  }

  const resolvedTarget = await resolveKnowledgePath({
    knowledgeRoot: input.knowledgeRoot,
    relativePath: target,
  });
  if (!resolvedTarget) {
    return {
      ...base,
      code: "relation_target_invalid",
      message: `Relation target '${input.relation.target}' escapes the knowledge root.`,
    };
  }

  if (input.inactivePaths.has(target)) {
    return {
      ...base,
      code: "relation_target_inactive",
      message: `Relation target '${target}' is not active.`,
    };
  }

  if (!input.activePaths.has(target)) {
    return {
      ...base,
      code: "relation_target_missing",
      message: `Relation target '${target}' does not exist in the active bundle.`,
    };
  }

  const targetFile = input.fileByPath.get(target);
  if (
    !targetFile?.isParseable ||
    !input.relation.targetType ||
    input.relation.targetType !== targetFile.type
  ) {
    return {
      ...base,
      code: "relation_target_type_mismatch",
      message: `Relation target type '${input.relation.targetType ?? "missing"}' does not match '${targetFile?.type ?? "unknown"}'.`,
    };
  }

  return null;
}

function resolveRelationPath(sourceFile: string, rawTarget: string): string | null {
  if (
    !rawTarget ||
    rawTarget.includes("\\") ||
    rawTarget.includes("?") ||
    rawTarget.includes("#") ||
    path.posix.isAbsolute(rawTarget) ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(rawTarget)
  ) {
    return null;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(rawTarget);
  } catch {
    return null;
  }

  const target = path.posix.normalize(
    path.posix.join(path.posix.dirname(sourceFile), decoded),
  );
  return target === ".." || target.startsWith("../") || !target.endsWith(".md")
    ? null
    : target;
}

function getBacklinks(
  filename: string,
  edges: OkfExplorerEdge[],
  fileByPath: Map<string, OkfExplorerFile & { relations: ReturnType<typeof getFrontmatterRelations> }>,
): OkfExplorerBacklink[] {
  return edges
    .filter((edge) => edge.target === filename)
    .map((edge) => ({
      reason: edge.reason,
      relation: edge.relation,
      sourceFile: edge.source,
      sourceTitle: fileByPath.get(edge.source)?.title ?? edge.source,
    }));
}

function getDefaultFile(files: OkfExplorerFile[], nodes: OkfExplorerNode[]): string | null {
  return (
    files.find((file) => file.filename === "index.md")?.filename ??
    nodes[0]?.id ??
    files[0]?.filename ??
    null
  );
}

function getSelectedFile(
  files: OkfExplorerFile[],
  defaultFile: string | null,
  requestedFile?: string,
): string | null {
  if (
    requestedFile &&
    !requestedFile.includes("\\") &&
    !path.posix.isAbsolute(requestedFile) &&
    files.some((file) => file.filename === requestedFile)
  ) {
    return requestedFile;
  }

  return defaultFile;
}

function sortTree(nodes: OkfTreeNode[]) {
  nodes.sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === "directory" ? -1 : 1;
    }
    return left.label.localeCompare(right.label);
  });
  nodes.forEach((node) => sortTree(node.children));
}

function compareEdges(left: OkfExplorerEdge, right: OkfExplorerEdge) {
  return (
    left.source.localeCompare(right.source) ||
    left.target.localeCompare(right.target) ||
    left.relation.localeCompare(right.relation) ||
    left.id.localeCompare(right.id)
  );
}

function compareIssues(left: OkfExplorerIssue, right: OkfExplorerIssue) {
  return (
    left.file.localeCompare(right.file) ||
    (left.relationIndex ?? -1) - (right.relationIndex ?? -1) ||
    left.code.localeCompare(right.code)
  );
}

function isMissingPathError(error: unknown) {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

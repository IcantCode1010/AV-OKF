export const ALL_DOCUMENTS_PURGE_CONFIRMATION = "PURGE-ALL-DOCUMENTS";
export const DEFAULT_DOCUMENT_PURGE_POLL_MS = 1_000;
export const DEFAULT_DOCUMENT_PURGE_TIMEOUT_MS = 30 * 60 * 1_000;

export type DocumentPurgeOptions = {
  apply: boolean;
  confirmation: string | null;
  pollMs: number;
  timeoutMs: number;
};

export type DocumentPurgeInventoryItem = {
  knowledgeBundleId: string | null;
  objectCount: number;
  topicCount: number;
  workspaceId: string;
};

export type DocumentPurgeInventory = {
  documentCount: number;
  objectCount: number;
  topicCount: number;
  workspaces: Array<{
    documentCount: number;
    objectCount: number;
    topicCount: number;
    workspaceId: string;
  }>;
};

export function parseDocumentPurgeOptions(args: string[]): DocumentPurgeOptions {
  const apply = args.includes("--apply");
  const confirmation = readArg(args, "--confirm") ?? null;
  const pollMs = readPositiveIntegerArg(
    args,
    "--poll-ms",
    DEFAULT_DOCUMENT_PURGE_POLL_MS,
  );
  const timeoutMs = readPositiveIntegerArg(
    args,
    "--timeout-ms",
    DEFAULT_DOCUMENT_PURGE_TIMEOUT_MS,
  );

  if (apply && confirmation !== ALL_DOCUMENTS_PURGE_CONFIRMATION) {
    throw new Error(
      `document_purge_apply_requires_--confirm_${ALL_DOCUMENTS_PURGE_CONFIRMATION}`,
    );
  }

  return { apply, confirmation, pollMs, timeoutMs };
}

export function buildDocumentPurgeInventory(
  documents: DocumentPurgeInventoryItem[],
): DocumentPurgeInventory {
  const byWorkspace = new Map<
    string,
    { documentCount: number; objectCount: number; topicCount: number }
  >();

  for (const document of documents) {
    const totals = byWorkspace.get(document.workspaceId) ?? {
      documentCount: 0,
      objectCount: 0,
      topicCount: 0,
    };
    totals.documentCount += 1;
    totals.objectCount += document.objectCount;
    totals.topicCount += document.topicCount;
    byWorkspace.set(document.workspaceId, totals);
  }

  const workspaces = Array.from(byWorkspace, ([workspaceId, totals]) => ({
    ...totals,
    workspaceId,
  })).sort((left, right) => left.workspaceId.localeCompare(right.workspaceId));

  return {
    documentCount: documents.length,
    objectCount: workspaces.reduce((sum, item) => sum + item.objectCount, 0),
    topicCount: workspaces.reduce((sum, item) => sum + item.topicCount, 0),
    workspaces,
  };
}

export function isRuntimeDocumentObjectKey(value: string) {
  const normalized = value.replaceAll("\\", "/");
  return /^workspaces\/[^/]+\/documents\/[^/]+\//.test(normalized);
}

export function shouldPurgeRuntimeKnowledgeFile(value: string) {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "");
  if (
    normalized.startsWith("/") ||
    normalized.split("/").some((segment) => segment === "..")
  ) {
    throw new Error("document_purge_unsafe_knowledge_path");
  }
  if (!normalized.toLowerCase().endsWith(".md")) return false;
  if (["index.md", "log.md"].includes(normalized)) return false;
  return !normalized.startsWith("references/history/");
}

function readArg(args: string[], name: string) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function readPositiveIntegerArg(args: string[], name: string, fallback: number) {
  const raw = readArg(args, name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`document_purge_invalid_${name.slice(2).replaceAll("-", "_")}`);
  }
  return parsed;
}

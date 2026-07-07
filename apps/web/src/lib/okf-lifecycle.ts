import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { getDefaultKnowledgeRoot } from "./knowledge-root.ts";
import { buildOkfSystemTopic } from "./okf-export.ts";
import { getPrisma } from "./prisma.ts";
import type {
  OkfConceptLifecycleLookup,
  OkfConceptLifecycleRecord,
  OkfConceptLifecycleStatus,
} from "./okf-bundle-retriever.ts";

const ACTIVE_LIFECYCLE: OkfConceptLifecycleRecord = { status: "active" };

type LifecycleClient = {
  document?: {
    findUnique?(input: unknown): Promise<LifecycleFilenameDocument | null>;
    delete(input: unknown): Promise<unknown>;
  };
  okfConceptLifecycle?: {
    findMany?(
      input: unknown,
    ): Promise<Array<{ filePath: string; reason: string | null; status: string }>>;
    findUnique?(input: unknown): Promise<{ reason: string | null; status: string } | null>;
    upsert(input: unknown): Promise<unknown>;
  };
  topicRecord?: {
    findMany?(input: unknown): Promise<LifecycleFilenameTopic[]>;
  };
};

type LifecycleFilenameDocument = {
  aircraftFamily: string | null;
  ata: string | null;
  effectivity: string | null;
  manualType: string | null;
  revision: string | null;
  sourceAuthority: string | null;
  title: string;
};

type LifecycleFilenameTopic = {
  id: string;
  pageEnd: number;
  pageStart: number;
  reviewStatus: string;
  sourcePageNumbers: number[];
  summary: string;
  title: string;
};

export function normalizeOkfConceptLifecycleStatus(
  value: string | null | undefined,
): OkfConceptLifecycleStatus {
  if (
    value === "archived" ||
    value === "deleted" ||
    value === "retracted"
  ) {
    return value;
  }

  return "active";
}

export function createPostgresOkfConceptLifecycleLookup(
  db = getPrisma(),
): OkfConceptLifecycleLookup {
  return async ({ filePath, workspaceId }) => {
    return getOkfConceptLifecycleForFile({
      client: db,
      filePath,
      workspaceId,
    });
  };
}

export async function getOkfConceptLifecycleForFile(input: {
  client?: LifecycleClient;
  filePath: string;
  workspaceId: string;
}): Promise<OkfConceptLifecycleRecord> {
  const client = input.client ?? getPrisma();
  const record = await client.okfConceptLifecycle!.findUnique!({
    where: {
      workspaceId_filePath: {
        filePath: input.filePath,
        workspaceId: input.workspaceId,
      },
    },
  });

  if (!record) {
    return ACTIVE_LIFECYCLE;
  }

  return {
    reason: record.reason,
    status: normalizeOkfConceptLifecycleStatus(record.status),
  };
}

export async function getOkfConceptLifecycleByFile(input: {
  client?: LifecycleClient;
  filePaths: string[];
  workspaceId: string;
}): Promise<Map<string, OkfConceptLifecycleRecord>> {
  const uniqueFilePaths = Array.from(new Set(input.filePaths));
  const lifecycles = new Map<string, OkfConceptLifecycleRecord>(
    uniqueFilePaths.map((filePath) => [filePath, ACTIVE_LIFECYCLE]),
  );

  if (uniqueFilePaths.length === 0) {
    return lifecycles;
  }

  const client = input.client ?? getPrisma();
  const records = await client.okfConceptLifecycle!.findMany!({
    where: {
      filePath: { in: uniqueFilePaths },
      workspaceId: input.workspaceId,
    },
  });

  for (const record of records) {
    lifecycles.set(record.filePath, {
      reason: record.reason,
      status: normalizeOkfConceptLifecycleStatus(record.status),
    });
  }

  return lifecycles;
}

export function buildOkfLifecycleFilename(input: {
  document: LifecycleFilenameDocument;
  knowledgeVersion: string;
  topic: LifecycleFilenameTopic;
}): string {
  return buildOkfSystemTopic({
    document: input.document,
    knowledgeVersion: input.knowledgeVersion,
    topic: { ...input.topic, reviewStatus: "approved" },
  }).filename;
}

export async function softDeleteDocument(input: {
  actorId: string;
  client?: LifecycleClient;
  deletedAt?: Date;
  documentId: string;
  knowledgeRoot?: string;
  reason: string;
  workspaceId: string;
}): Promise<void> {
  const client = input.client ?? getPrisma();
  const deletedAt = input.deletedAt ?? new Date();
  const reason = input.reason.trim();

  if (reason.length === 0) {
    throw new Error("document_delete_reason_required");
  }

  await removeDerivedKnowledgeProducts({
    actorId: input.actorId,
    changedAt: deletedAt,
    client,
    documentId: input.documentId,
    knowledgeRoot: input.knowledgeRoot,
    reason,
    workspaceId: input.workspaceId,
  });

  await client.document!.delete({
    where: { id: input.documentId, workspaceId: input.workspaceId },
  });
}

async function removeDerivedKnowledgeProducts(input: {
  actorId: string;
  changedAt: Date;
  client: LifecycleClient;
  documentId: string;
  knowledgeRoot?: string;
  reason: string;
  workspaceId: string;
}) {
  const documentTopics = await input.client.topicRecord!.findMany!({
    where: {
      documentId: input.documentId,
      workspaceId: input.workspaceId,
    },
  });

  const document = await input.client.document!.findUnique!({
    select: {
      aircraftFamily: true,
      ata: true,
      effectivity: true,
      manualType: true,
      revision: true,
      sourceAuthority: true,
      title: true,
    },
    where: { id: input.documentId, workspaceId: input.workspaceId },
  });

  if (!document) {
    throw new Error("document_not_found");
  }

  if (documentTopics.length > 0) {
    const exportedFilenames = documentTopics.map((topic) =>
      buildOkfLifecycleFilename({
        document,
        knowledgeVersion: process.env.AV_OKF_KNOWLEDGE_VERSION || "0.1.0",
        topic,
      }),
    );

    await removeDeletedDocumentFromKnowledgeBundle({
      documentTitle: document.title,
      filenames: exportedFilenames,
      knowledgeRoot: input.knowledgeRoot ?? getDefaultKnowledgeRoot(),
    });
  }

  await appendDocumentDeleteLogEntry({
    actorId: input.actorId,
    changedAt: input.changedAt,
    conceptCount: documentTopics.length,
    documentTitle: document.title,
    knowledgeRoot: input.knowledgeRoot ?? getDefaultKnowledgeRoot(),
    reason: input.reason,
  });
}

async function removeDeletedDocumentFromKnowledgeBundle(input: {
  documentTitle: string;
  filenames: string[];
  knowledgeRoot: string;
}) {
  const root = path.resolve(input.knowledgeRoot);

  for (const filename of input.filenames) {
    const target = path.resolve(root, filename);
    if (target !== root && target.startsWith(`${root}${path.sep}`)) {
      await rm(/*turbopackIgnore: true*/ target, { force: true });
    }
  }

  await removeIndexEntries({
    filenames: input.filenames,
    knowledgeRoot: root,
  });
  await removeSourceManifestEntry({
    documentTitle: input.documentTitle,
    knowledgeRoot: root,
  });
}

async function removeIndexEntries(input: {
  filenames: string[];
  knowledgeRoot: string;
}) {
  const indexPath = path.join(input.knowledgeRoot, "index.md");
  let existing = "";

  try {
    existing = await readFile(/*turbopackIgnore: true*/ indexPath, "utf8");
  } catch {
    return;
  }

  const filenameSet = new Set(input.filenames);
  const filtered = existing
    .split(/\r?\n/)
    .filter((line) => {
      return !Array.from(filenameSet).some((filename) =>
        line.includes(`](${filename})`),
      );
    });

  await writeFile(
    /*turbopackIgnore: true*/ indexPath,
    `${filtered.join("\n").trimEnd()}\n`,
    "utf8",
  );
}

async function removeSourceManifestEntry(input: {
  documentTitle: string;
  knowledgeRoot: string;
}) {
  const manifestPath = path.join(input.knowledgeRoot, "source_manifest.md");
  let existing = "";

  try {
    existing = await readFile(/*turbopackIgnore: true*/ manifestPath, "utf8");
  } catch {
    return;
  }

  const lines = existing.split(/\r?\n/);
  const filtered: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.trim() !== `- ${input.documentTitle}`) {
      filtered.push(line);
      continue;
    }

    while (index + 1 < lines.length && lines[index + 1]!.startsWith("  - ")) {
      index += 1;
    }
  }

  await writeFile(
    /*turbopackIgnore: true*/ manifestPath,
    `${filtered.join("\n").trimEnd()}\n`,
    "utf8",
  );
}

async function appendDocumentDeleteLogEntry(input: {
  actorId: string;
  changedAt: Date;
  conceptCount: number;
  documentTitle: string;
  knowledgeRoot: string;
  reason: string;
}) {
  const logPath = path.join(input.knowledgeRoot, "log.md");
  const entry = [
    `- ${toIsoDate(input.changedAt)} - delete-document`,
    `source: ${input.documentTitle}`,
    `actor: ${input.actorId}`,
    `concepts_removed: ${input.conceptCount}`,
    `reason: ${input.reason}`,
  ].join(" - ");
  let existing = "";

  try {
    existing = await readFile(/*turbopackIgnore: true*/ logPath, "utf8");
  } catch {
    existing = "";
  }

  const base = existing.trimEnd() || "# Change Log";
  await writeFile(
    /*turbopackIgnore: true*/ logPath,
    `${base}\n\n${entry}\n`,
    "utf8",
  );
}

export async function markOkfConceptLifecycle(input: {
  actorId: string;
  changedAt?: Date;
  client?: LifecycleClient;
  filePath: string;
  knowledgeRoot?: string;
  reason: string;
  status: Exclude<OkfConceptLifecycleStatus, "active" | "deleted">;
  topicId?: string | null;
  workspaceId: string;
}): Promise<void> {
  const client = input.client ?? getPrisma();
  const changedAt = input.changedAt ?? new Date();
  const reason = input.reason.trim();

  if (reason.length === 0) {
    throw new Error("okf_lifecycle_reason_required");
  }

  await client.okfConceptLifecycle!.upsert({
    create: {
      changedAt,
      changedBy: input.actorId,
      filePath: input.filePath,
      reason,
      status: input.status,
      topicId: input.topicId ?? null,
      workspaceId: input.workspaceId,
    },
    update: {
      changedAt,
      changedBy: input.actorId,
      reason,
      status: input.status,
      topicId: input.topicId ?? null,
    },
    where: {
      workspaceId_filePath: {
        filePath: input.filePath,
        workspaceId: input.workspaceId,
      },
    },
  });

  await appendLifecycleLogEntry({
    changedAt,
    filePath: input.filePath,
    knowledgeRoot: input.knowledgeRoot ?? getDefaultKnowledgeRoot(),
    reason,
    status: input.status,
  });
}

async function appendLifecycleLogEntry(input: {
  changedAt: Date;
  filePath: string;
  knowledgeRoot: string;
  reason: string;
  status: "archived" | "retracted";
}) {
  const logPath = path.join(input.knowledgeRoot, "log.md");
  const entry = `- ${toIsoDate(input.changedAt)} - ${input.status} - ${input.filePath} - ${input.reason}`;
  let existing = "";

  try {
    existing = await readFile(/*turbopackIgnore: true*/ logPath, "utf8");
  } catch {
    existing = "";
  }

  const base = existing.trimEnd() || "# Change Log";
  await writeFile(
    /*turbopackIgnore: true*/ logPath,
    `${base}\n\n${entry}\n`,
    "utf8",
  );
}

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

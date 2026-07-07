import { readFile, writeFile } from "node:fs/promises";
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
const RAW_EXTRACTION_SOURCE_TYPE = "raw_extraction";

type LifecycleClient = {
  document?: {
    update(input: unknown): Promise<unknown>;
  };
  okfConceptLifecycle?: {
    findUnique?(input: unknown): Promise<{ reason: string | null; status: string } | null>;
    upsert(input: unknown): Promise<unknown>;
  };
  ragChunk?: {
    updateMany(input: unknown): Promise<unknown>;
  };
  topicRecord?: {
    count(input: unknown): Promise<number>;
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
    const record = await db.okfConceptLifecycle.findUnique({
      where: {
        workspaceId_filePath: {
          filePath,
          workspaceId,
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
  };
}

export function buildOkfLifecycleFilename(input: {
  document: LifecycleFilenameDocument;
  knowledgeVersion: string;
  topic: LifecycleFilenameTopic;
}): string {
  return buildOkfSystemTopic({
    document: input.document,
    knowledgeVersion: input.knowledgeVersion,
    topic: input.topic,
  }).filename;
}

export async function assertDocumentCanBeSoftDeleted(input: {
  client?: LifecycleClient;
  documentId: string;
  workspaceId: string;
}): Promise<void> {
  const client = input.client ?? getPrisma();
  const approvedTopicCount = await client.topicRecord!.count({
    where: {
      documentId: input.documentId,
      reviewStatus: "approved",
      workspaceId: input.workspaceId,
    },
  });

  if (approvedTopicCount > 0) {
    throw new Error("document_delete_blocked_by_approved_okf");
  }
}

export async function softDeleteDocument(input: {
  actorId: string;
  client?: LifecycleClient;
  deletedAt?: Date;
  documentId: string;
  reason: string;
  workspaceId: string;
}): Promise<void> {
  const client = input.client ?? getPrisma();
  const deletedAt = input.deletedAt ?? new Date();
  const reason = input.reason.trim();

  if (reason.length === 0) {
    throw new Error("document_delete_reason_required");
  }

  await assertDocumentCanBeSoftDeleted({
    client,
    documentId: input.documentId,
    workspaceId: input.workspaceId,
  });

  await client.document!.update({
    data: {
      deletedAt,
      deletedBy: input.actorId,
      deleteReason: reason,
      status: "deleted",
    },
    where: { id: input.documentId, workspaceId: input.workspaceId },
  });

  await client.ragChunk!.updateMany({
    data: { isActive: false },
    where: {
      documentId: input.documentId,
      sourceType: RAW_EXTRACTION_SOURCE_TYPE,
      workspaceId: input.workspaceId,
    },
  });
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

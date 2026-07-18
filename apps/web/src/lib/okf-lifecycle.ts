import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { getDefaultKnowledgeRoot } from "./knowledge-root.ts";
import { getPrisma } from "./prisma.ts";
import type {
  OkfConceptLifecycleLookup,
  OkfConceptLifecycleRecord,
  OkfConceptLifecycleStatus,
} from "./okf-bundle-retriever.ts";

const ACTIVE_LIFECYCLE: OkfConceptLifecycleRecord = { status: "active" };

type LifecycleClient = {
  activityEvent?: {
    create(input: unknown): Promise<unknown>;
  };
  document?: {
    update(input: unknown): Promise<{ title: string }>;
  };
  okfConceptLifecycle?: {
    findMany?(
      input: unknown,
    ): Promise<Array<{ filePath: string; reason: string | null; status: string }>>;
    findUnique?(input: unknown): Promise<{ reason: string | null; status: string } | null>;
    upsert(input: unknown): Promise<unknown>;
  };
  ragChunk?: {
    updateMany(input: unknown): Promise<unknown>;
  };
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
  return async ({ filePath, knowledgeBundleId, workspaceId }) => {
    return getOkfConceptLifecycleForFile({
      client: db,
      filePath,
      knowledgeBundleId,
      workspaceId,
    });
  };
}

export async function getOkfConceptLifecycleForFile(input: {
  knowledgeBundleId: string;
  client?: LifecycleClient;
  filePath: string;
  workspaceId: string;
}): Promise<OkfConceptLifecycleRecord> {
  const client = input.client ?? getPrisma();
  const record = await client.okfConceptLifecycle!.findUnique!({
    where: {
      knowledgeBundleId_filePath: {
        filePath: input.filePath,
        knowledgeBundleId: input.knowledgeBundleId,
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
  knowledgeBundleId: string;
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
      knowledgeBundleId: input.knowledgeBundleId,
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

  const document = await client.document!.update({
    data: {
      deleteReason: reason,
      deletedAt,
      deletedBy: input.actorId,
    },
    select: { title: true },
    where: { id: input.documentId, workspaceId: input.workspaceId },
  });

  // Only raw-extraction chunks are tied to the deleted source document.
  // okf_topic chunks index the exported OKF bundle files, which are left
  // in place, so they stay active and searchable.
  await client.ragChunk!.updateMany({
    data: { isActive: false },
    where: {
      documentId: input.documentId,
      sourceType: "raw_extraction",
      workspaceId: input.workspaceId,
    },
  });

  await client.activityEvent!.create({
    data: {
      documentId: input.documentId,
      documentTitle: document.title,
      label: `Document soft-deleted: ${reason}`,
      status: "blocked",
      timestamp: "Just now",
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
  knowledgeBundleId: string;
  reason: string;
  status: Exclude<OkfConceptLifecycleStatus, "active">;
  topicId?: string | null;
  workspaceId: string;
  embeddingCleanup?: (input: {
    filePath: string;
    knowledgeBundleId: string;
    workspaceId: string;
  }) => Promise<void>;
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
      knowledgeBundleId: input.knowledgeBundleId,
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
      knowledgeBundleId_filePath: {
        filePath: input.filePath,
        knowledgeBundleId: input.knowledgeBundleId,
      },
    },
  });

  if (input.embeddingCleanup) {
    await input.embeddingCleanup(input);
  } else if (process.env.AV_OKF_BACKEND === "production") {
    const { createOkfConceptEmbeddingRepository } = await import("./okf-concept-embedding.ts");
    await createOkfConceptEmbeddingRepository().deleteForFile(input);
  }

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
  status: Exclude<OkfConceptLifecycleStatus, "active">;
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

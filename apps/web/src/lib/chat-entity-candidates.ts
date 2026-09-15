import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";

import type { AuthWorkspaceContext } from "./auth-workspace.ts";
import type { ChatCitation } from "./chat-types.ts";
import type { ChatEntityCandidate } from "./chat-router.ts";
import {
  normalizeKnowledgeProfile,
  type KnowledgeProfileSchema,
} from "./knowledge-profile.ts";
import { getPrisma } from "./prisma.ts";

type PrismaLike = ReturnType<typeof getPrisma>;

export type PromotedChatEntity = {
  created: boolean;
  documentId: string;
  topicId: string;
};

export async function promoteChatEntityCandidate(
  input: {
    candidateId: string;
    context: AuthWorkspaceContext;
    messageId: string;
  },
  db: PrismaLike = getPrisma(),
): Promise<PromotedChatEntity> {
  const message = await db.chatMessage.findFirst({
    where: {
      id: input.messageId,
      role: "assistant",
      workspaceId: input.context.workspaceId,
    },
  });
  if (!message) throw new Error("chat_entity_candidate_not_found");

  const candidate = readEntityCandidates(message.trace).find(
    (item) => item.id === input.candidateId,
  );
  if (!candidate) throw new Error("chat_entity_candidate_not_found");

  const citation = readCitations(message.citations).find(
    (item) => item.index === candidate.citationIndex,
  );
  if (!citation?.knowledgeBundleId) {
    throw new Error("chat_entity_candidate_source_unavailable");
  }
  if (!message.knowledgeBundleIds.includes(citation.knowledgeBundleId)) {
    throw new Error("chat_entity_candidate_bundle_mismatch");
  }

  const source = await resolveSourceDocument({
    citation,
    db,
    workspaceId: input.context.workspaceId,
  });
  if (
    !source ||
    source.knowledgeBundleId !== citation.knowledgeBundleId ||
    source.deletedAt
  ) {
    throw new Error("chat_entity_candidate_source_unavailable");
  }

  const bundle = await db.knowledgeBundle.findFirst({
    include: { activeProfileVersion: true },
    where: {
      id: citation.knowledgeBundleId,
      status: "active",
      workspaceId: input.context.workspaceId,
    },
  });
  if (!bundle?.activeProfileVersion) {
    throw new Error("chat_entity_candidate_bundle_unavailable");
  }
  const profile = normalizeKnowledgeProfile(
    bundle.activeProfileVersion.schema as unknown as KnowledgeProfileSchema,
  );
  if (!profile.types.entity) {
    throw new Error("knowledge_profile_entity_type_not_allowed");
  }

  const existing = await findExistingEntity({
    bundleId: bundle.id,
    db,
    name: candidate.name,
    workspaceId: input.context.workspaceId,
  });
  if (existing) {
    return {
      created: false,
      documentId: existing.documentId,
      topicId: existing.id,
    };
  }

  const pageNumbers = await resolveSourcePages({
    citation,
    db,
    documentId: source.id,
    workspaceId: input.context.workspaceId,
  });
  if (pageNumbers.length === 0) {
    throw new Error("chat_entity_candidate_source_pages_unavailable");
  }

  const topicId = buildEntityTopicId(bundle.id, candidate.name);
  try {
    const created = await db.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(2147483021, hashtext(${`${input.context.workspaceId}:${bundle.id}:${topicId}`}))`;
      const existingById = await tx.topicRecord.findUnique({
        where: { id: topicId },
      });
      if (existingById) {
        assertMatchingEntityIdentity({
          bundleId: bundle.id,
          name: candidate.name,
          topic: existingById,
          workspaceId: input.context.workspaceId,
        });
        return { created: false, topic: existingById };
      }
      const concurrent = await tx.topicRecord.findFirst({
        where: {
          knowledgeBundleId: bundle.id,
          OR: [
            { title: { equals: candidate.name, mode: "insensitive" } },
            { enrichedTitle: { equals: candidate.name, mode: "insensitive" } },
          ],
          reviewStatus: { not: "rejected" },
          topicType: "entity",
          workspaceId: input.context.workspaceId,
        },
      });
      if (concurrent) return { created: false, topic: concurrent };

      const topic = await tx.topicRecord.create({
        data: {
          id: topicId,
          confidence: "medium",
          discoveryMetadata: {
            candidateId: candidate.id,
            chatMessageId: message.id,
            citationIndex: candidate.citationIndex,
            evidenceQuote: candidate.evidenceQuote,
            version: "chat-entity-v1",
          },
          documentId: source.id,
          enrichmentStatus: "none",
          knowledgeBundleId: bundle.id,
          okfMetadata: {
            entity_type: candidate.entityType,
            type: "entity",
          },
          originalSummary: candidate.summary,
          originalTitle: candidate.name,
          pageEnd: pageNumbers.at(-1)!,
          pageStart: pageNumbers[0]!,
          relations: [],
          reviewStatus: "needs_review",
          sourcePageNumbers: pageNumbers,
          summary: candidate.summary,
          title: candidate.name,
          topicType: "entity",
          workspaceId: input.context.workspaceId,
        },
      });
      await tx.activityEvent.create({
        data: {
          documentId: source.id,
          documentTitle: source.title,
          label: `Entity candidate added for review: ${candidate.name}`,
          status: "needs_review",
          timestamp: "Just now",
          workspaceId: input.context.workspaceId,
        },
      });
      return { created: true, topic };
    });

    return {
      created: created.created,
      documentId: created.topic.documentId,
      topicId: created.topic.id,
    };
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const concurrentById = await db.topicRecord.findUnique({
        where: { id: topicId },
      });
      if (concurrentById) {
        assertMatchingEntityIdentity({
          bundleId: bundle.id,
          name: candidate.name,
          topic: concurrentById,
          workspaceId: input.context.workspaceId,
        });
        return {
          created: false,
          documentId: concurrentById.documentId,
          topicId: concurrentById.id,
        };
      }
      const concurrent = await findExistingEntity({
        bundleId: bundle.id,
        db,
        name: candidate.name,
        workspaceId: input.context.workspaceId,
      });
      if (concurrent) {
        return {
          created: false,
          documentId: concurrent.documentId,
          topicId: concurrent.id,
        };
      }
    }
    throw error;
  }
}

export function readEntityCandidates(value: unknown): ChatEntityCandidate[] {
  if (!isRecord(value) || !Array.isArray(value.entityCandidates)) return [];
  return value.entityCandidates.filter(isChatEntityCandidate);
}

async function resolveSourceDocument(input: {
  citation: ChatCitation;
  db: PrismaLike;
  workspaceId: string;
}) {
  if (input.citation.documentId) {
    return input.db.document.findFirst({
      where: {
        id: input.citation.documentId,
        workspaceId: input.workspaceId,
      },
    });
  }
  if (
    input.citation.sourceType === "okf" &&
    input.citation.okfFilePath &&
    input.citation.knowledgeBundleId
  ) {
    const topic = await input.db.topicRecord.findFirst({
      include: { document: true },
      where: {
        exportedFilePath: normalizeBundlePath(input.citation.okfFilePath),
        knowledgeBundleId: input.citation.knowledgeBundleId,
        reviewStatus: "approved",
        workspaceId: input.workspaceId,
      },
    });
    return topic?.document ?? null;
  }
  return null;
}

async function resolveSourcePages(input: {
  citation: ChatCitation;
  db: PrismaLike;
  documentId: string;
  workspaceId: string;
}) {
  const start = Math.max(1, Math.min(input.citation.pageStart, input.citation.pageEnd));
  const end = Math.max(start, Math.max(input.citation.pageStart, input.citation.pageEnd));
  const pages = await input.db.extractedPage.findMany({
    orderBy: { pageNumber: "asc" },
    select: { pageNumber: true },
    where: {
      documentId: input.documentId,
      pageNumber: { gte: start, lte: end },
      workspaceId: input.workspaceId,
    },
  });
  return pages.map((page) => page.pageNumber);
}

async function findExistingEntity(input: {
  bundleId: string;
  db: PrismaLike;
  name: string;
  workspaceId: string;
}) {
  return input.db.topicRecord.findFirst({
    where: {
      knowledgeBundleId: input.bundleId,
      OR: [
        { title: { equals: input.name, mode: "insensitive" } },
        { enrichedTitle: { equals: input.name, mode: "insensitive" } },
      ],
      topicType: "entity",
      workspaceId: input.workspaceId,
    },
  });
}

function readCitations(value: unknown): ChatCitation[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is ChatCitation =>
    isRecord(item) &&
    typeof item.index === "number" &&
    typeof item.documentTitle === "string" &&
    (item.sourceType === "okf" || item.sourceType === "rag"),
  );
}

function isChatEntityCandidate(value: unknown): value is ChatEntityCandidate {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.summary === "string" &&
    typeof value.evidenceQuote === "string" &&
    typeof value.citationIndex === "number" &&
    typeof value.entityType === "string"
  );
}

function normalizeBundlePath(value: string) {
  return value.replaceAll("\\", "/").replace(/\/+/g, "/").replace(/^\/+/, "");
}

export function buildEntityTopicId(bundleId: string, name: string) {
  return `entity_${createHash("sha256")
    .update(`${bundleId}\0${name.normalize("NFKC").trim().toLocaleLowerCase()}`)
    .digest("hex")
    .slice(0, 24)}`;
}

export function assertMatchingEntityIdentity(input: {
  bundleId: string;
  name: string;
  topic: {
    enrichedTitle?: string | null;
    knowledgeBundleId: string;
    title: string;
    topicType: string;
    workspaceId: string;
  };
  workspaceId: string;
}) {
  const expectedName = normalizeEntityName(input.name);
  const names = [input.topic.title, input.topic.enrichedTitle]
    .filter((value): value is string => Boolean(value))
    .map(normalizeEntityName);
  if (
    input.topic.workspaceId !== input.workspaceId ||
    input.topic.knowledgeBundleId !== input.bundleId ||
    input.topic.topicType !== "entity" ||
    !names.includes(expectedName)
  ) {
    throw new Error("chat_entity_identity_collision");
  }
}

function normalizeEntityName(name: string) {
  return name.normalize("NFKC").trim().toLocaleLowerCase();
}

function isUniqueConstraintError(value: unknown) {
  return value instanceof Prisma.PrismaClientKnownRequestError && value.code === "P2002";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

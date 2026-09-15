import type { Document, TopicRecord } from "./document-vault.ts";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
export { getDefaultKnowledgeRoot } from "./knowledge-root.ts";
import {
  resolveOkfCoverage,
  syncOkfConceptCoverage,
  type OkfCoverageRepository,
} from "./okf-coverage.ts";
import { exportTopicToKnowledge } from "./okf-export.ts";
import { isProductionBackend } from "./production-document-service.ts";
import {
  getKnowledgeBundleByIdentity,
  resolveKnowledgeBundleRoot,
} from "./knowledge-bundles.ts";
import { getKnowledgeProfileTemplate, getTypeDirectory } from "./knowledge-profile.ts";
import { assertOkfV02Bundle } from "./okf-version.ts";
import { getPrisma } from "./prisma.ts";
import { getObjectStorage } from "./production-storage.ts";

type ExportApprovedTopicInput = {
  coverageRepository?: OkfCoverageRepository;
  document: Document;
  exportedAt?: Date;
  knowledgeRoot?: string;
  knowledgeVersion?: string;
  topicId: string;
  topics: TopicRecord[];
};

export async function exportApprovedTopicForDocument(
  input: ExportApprovedTopicInput,
): Promise<{ content: string; filename: string }> {
  const topic = input.topics.find((candidate) => candidate.id === input.topicId);

  if (!topic || topic.documentId !== input.document.id) {
    throw new Error("topic_not_found");
  }
  if (topic.reviewStatus !== "approved") {
    throw new Error("okf_export_requires_approved_topic");
  }
  if (!input.document.knowledgeBundleId) {
    throw new Error("document_requires_active_knowledge_bundle");
  }
  const knowledgeBundleId = input.document.knowledgeBundleId;

  const workspaceId = input.document.workspaceId ?? "local";
  const bundle = input.knowledgeRoot
    ? { profile: getKnowledgeProfileTemplate("generic") }
    : await getKnowledgeBundleByIdentity({
        bundleId: knowledgeBundleId,
        workspaceId,
      });
  if (!bundle) throw new Error("knowledge_bundle_not_found");
  const knowledgeRoot =
    input.knowledgeRoot ??
    resolveKnowledgeBundleRoot({ bundleId: knowledgeBundleId, workspaceId });
  await assertOkfV02Bundle({
    knowledgeRoot,
    okfVersion: "okfVersion" in bundle ? bundle.okfVersion : "0.2",
  });
  const conceptType =
    typeof topic.okfMetadata?.type === "string"
      ? topic.okfMetadata.type
      : "system_topic";
  const directory = getTypeDirectory(bundle.profile, conceptType);

  // Local JSON-vault exports have no RAG chunks to link against; only the
  // production Postgres backend populates coverage.
  const coverage =
    isProductionBackend() && input.document.workspaceId
      ? await resolveOkfCoverage({
          documentId: input.document.id,
          repository: input.coverageRepository,
          sourcePageNumbers: topic.sourcePageNumbers,
          workspaceId: input.document.workspaceId,
        })
      : null;
  const portableCitations = coverage && input.document.workspaceId && input.document.contentSha256
    ? buildPortableCitations({
        chunks: coverage.chunks,
        sourceDigest: input.document.contentSha256,
        sourcePages: topic.sourcePageNumbers,
      })
    : [];
  const media = isProductionBackend() && !input.knowledgeRoot && input.document.workspaceId
    ? await exportApprovedTopicMedia({
        contentSha256: input.document.contentSha256 ?? null,
        knowledgeRoot,
        topicId: topic.id,
        workspaceId: input.document.workspaceId,
      })
    : [];

  const exported = await exportTopicToKnowledge({
    directory,
    document: {
      ...input.document,
      contentSha256: input.document.contentSha256 ?? null,
    },
    exportedAt: input.exportedAt,
    knowledgeRoot,
    knowledgeVersion: input.knowledgeVersion ?? getKnowledgeVersion(),
    topic: coverage
      ? {
          ...topic,
          coverageType: coverage.coverageType,
          coveredRagChunkIds: coverage.chunkIds,
          portableCitations,
          media,
        }
      : { ...topic, media },
  });

  if (coverage && input.document.workspaceId) {
    await syncOkfConceptCoverage({
      chunkIds: coverage.chunkIds,
      coverageType: coverage.coverageType,
      knowledgeBundleId,
      okfConceptId: topic.id,
      repository: input.coverageRepository,
      workspaceId: input.document.workspaceId,
    });
  }

  if (
    isProductionBackend() &&
    !input.knowledgeRoot &&
    input.document.workspaceId &&
    input.document.knowledgeBundleId
  ) {
    const {
      createOkfConceptEmbeddingRepository,
      queueOkfConceptEmbedding,
    } = await import("./okf-concept-embedding.ts");
    const repository = createOkfConceptEmbeddingRepository();
    if (topic.exportedFilePath && topic.exportedFilePath !== exported.filename) {
      await repository.deleteForFile({
        filePath: topic.exportedFilePath,
        knowledgeBundleId: input.document.knowledgeBundleId,
        workspaceId: input.document.workspaceId,
      });
    }
    await queueOkfConceptEmbedding({
      bundleName: "name" in bundle ? bundle.name : "Knowledge Bundle",
      filePath: exported.filename,
      knowledgeBundleId: input.document.knowledgeBundleId,
      markdown: exported.content,
      repository,
      workspaceId: input.document.workspaceId,
    });
  }

  return exported;
}

async function exportApprovedTopicMedia(input: {
  contentSha256: string | null;
  knowledgeRoot: string;
  topicId: string;
  workspaceId: string;
}) {
  const db = getPrisma();
  const references = await db.topicMediaReference.findMany({
    include: { mediaAsset: true },
    orderBy: [{ confidence: "desc" }, { createdAt: "asc" }],
    where: {
      status: { in: ["approved", "auto_approved"] },
      topicId: input.topicId,
      workspaceId: input.workspaceId,
    },
  });
  const storage = getObjectStorage();
  const media = [];
  for (const reference of references) {
    if (!input.contentSha256 || reference.mediaAsset.sourceDocumentSha256 !== input.contentSha256) {
      await db.topicMediaReference.update({ data: { status: "stale" }, where: { id: reference.id } });
      continue;
    }
    const filename = `${reference.mediaAsset.id}-${reference.mediaAsset.contentSha256.slice(0, 12)}.png`;
    const resourcePath = path.posix.join("resources", "media", filename);
    const destination = path.join(input.knowledgeRoot, ...resourcePath.split("/"));
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, await storage.getObject(reference.mediaAsset.objectKey));
    media.push({
      altText: reference.mediaAsset.altText,
      kind: reference.mediaAsset.kind === "diagram" ? "diagram" as const : "figure" as const,
      pageNumber: reference.mediaAsset.pageNumber,
      resourcePath,
      sourceCaption: reference.mediaAsset.sourceCaption,
      visualContext: reference.mediaAsset.visualContext,
    });
  }
  return media;
}

function buildPortableCitations(input: { chunks: Array<{ contentHash: string; sourcePageNumbers: number[] }>; sourceDigest: string; sourcePages: number[] }) {
  const digest = input.sourceDigest.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error("okf_export_requires_source_hash");
  const allowedPages = new Set(input.sourcePages);
  const portableChunks = input.chunks.map((chunk) => ({
      id: `avchunk:${digest}:${chunk.contentHash}`,
      pages: chunk.sourcePageNumbers.filter((page) => allowedPages.has(page)),
    })).filter((chunk) => chunk.pages.length > 0);
  return portableChunks.length ? [{
    chunks: portableChunks,
    source: `source-${digest.slice(0, 12)}`,
  }] : [];
}

function getKnowledgeVersion() {
  return process.env.AV_OKF_KNOWLEDGE_VERSION || "0.2.0";
}

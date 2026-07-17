import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { LOCAL_GENERAL_BUNDLE_ID } from "./knowledge-bundles.ts";
import { setTimeout as delay } from "node:timers/promises";

import { generateTopicCandidates } from "./topic-records.ts";
import {
  normalizeTopicRelations,
  type TopicRelation,
} from "./okf-relation-types.ts";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export type Workspace = {
  id: string;
  name: string;
  plan: string;
  memberCount: number;
};

export type User = {
  id: string;
  name: string;
  email: string;
  initials: string;
  role: string;
};

export type DocumentStatus =
  | "ready"
  | "processing"
  | "needs_review"
  | "indexed"
  | "blocked";

export type SourceType = "aviation" | "general";

export type CustomProperty = {
  key: string;
  value: string;
};

export type ExtractionStatus = "queued" | "running" | "completed" | "failed";

export type ExtractionLog = {
  id: string;
  timestamp: string;
  level: "info" | "warning" | "error";
  message: string;
};

export type ExtractedTable = {
  index: number;
  rows: string[][];
};

export type ExtractedPageRecord = {
  pageNumber: number;
  text: string;
  tables: ExtractedTable[];
  imageCount: number;
  charCount: number;
};

export type ExtractionError = {
  code: string;
  message: string;
};

export type DocumentExtraction = {
  status: ExtractionStatus;
  startedAt: string | null;
  completedAt: string | null;
  error: ExtractionError | null;
  pageRecords: ExtractedPageRecord[];
  logs: ExtractionLog[];
};

export type TopicConfidence = "low" | "medium" | "high";

export type TopicDiscoveryStatus =
  | "not_started"
  | "queued"
  | "analyzing"
  | "consolidating"
  | "completed"
  | "awaiting_provider"
  | "failed";

export type DocumentTopicDiscovery = {
  completedWindows: number;
  errorMessage: string | null;
  estimatedInputTokens: number;
  status: TopicDiscoveryStatus;
  totalWindows: number;
};

export type TopicReviewStatus =
  | "needs_review"
  | "needs_cleanup"
  | "approved"
  | "rejected";

export type TopicEnrichmentStatus =
  | "none"
  | "pending"
  | "completed"
  | "failed";

export type ApprovedContentSource = "raw" | "enriched";

export type TopicEnrichmentAudit = {
  id: string;
  topicId: string;
  provider: string;
  model: string;
  promptSent: string;
  rawResponse: string;
  createdAt: string;
  requestedBy: string;
  succeeded: boolean;
  errorMessage: string | null;
};

export type TopicRecord = {
  id: string;
  knowledgeBundleId: string;
  documentId: string;
  originalTitle: string;
  originalSummary: string;
  title: string;
  topicType: string;
  summary: string;
  enrichedTitle: string | null;
  enrichedSummary: string | null;
  enrichedBody: string | null;
  proposedSourcePageNumbers: number[];
  discoveryMetadata: Record<string, unknown>;
  enrichmentStatus: TopicEnrichmentStatus;
  approvedContentSource: ApprovedContentSource | null;
  enrichedAt: string | null;
  enrichmentModel: string | null;
  enrichmentErrorMessage: string | null;
  editedAt: string | null;
  editedBy: string | null;
  pageStart: number;
  pageEnd: number;
  confidence: TopicConfidence;
  reviewStatus: TopicReviewStatus;
  relations: TopicRelation[];
  sourcePageNumbers: number[];
  exportedFilePath: string | null;
  okfMetadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type Document = {
  id: string;
  workspaceId?: string;
  knowledgeBundleId: string;
  title: string;
  fileType: string;
  size: string;
  sizeBytes: number;
  status: DocumentStatus;
  tags: string[];
  updatedAt: string;
  owner: string;
  sourceType: SourceType;
  pages: number;
  description: string;
  storageKey: string | null;
  originalFilename: string | null;
  mimeType: string;
  customProperties: CustomProperty[];
  subjectFamily: string | null;
  documentType: string | null;
  classificationCode: string | null;
  effectivity: string | null;
  sourceAuthority: string | null;
  revision: string | null;
  extraction: DocumentExtraction;
  topicDiscovery?: DocumentTopicDiscovery;
};

export type DocumentMetrics = {
  total: number;
  processing: number;
  ready: number;
  review: number;
};

export type ActivityEvent = {
  id: string;
  label: string;
  documentTitle: string;
  timestamp: string;
  status: DocumentStatus;
};

type VaultStore = {
  documents: Document[];
  activityEvents: ActivityEvent[];
  topicEnrichmentAudits?: TopicEnrichmentAudit[];
  topicRecords?: TopicRecord[];
};

type UploadMetadata = {
  bytes: Buffer;
  description: string;
  knowledgeBundleId: string;
  originalFilename: string;
  owner: string;
  sourceType: SourceType;
  tags: string[];
  title: string;
  type: string;
};

type UpdateMetadata = {
  subjectFamily: string | null;
  classificationCode: string | null;
  description: string;
  effectivity: string | null;
  documentType: string | null;
  owner: string;
  revision: string | null;
  sourceAuthority: string | null;
  sourceType: SourceType;
  status: DocumentStatus;
  tags: string[];
  title: string;
  customProperties: CustomProperty[];
};

type CompleteExtractionInput = {
  pageRecords: ExtractedPageRecord[];
};

type UpdateTopicContentInput = {
  editedBy: string;
  summary?: string;
  title?: string;
};

const currentUser: User = {
  id: "usr_demo",
  name: "Ellis Carter",
  email: "ellis@example.com",
  initials: "EC",
  role: "Workspace Admin",
};

const workspace: Workspace = {
  id: "wrk_av_okf",
  name: "AV-OKF Demo Workspace",
  plan: "Stage 1 Local Vault",
  memberCount: 4,
};

const seedDocuments: Document[] = [
  {
    id: "doc-737ng-amm-24",
    workspaceId: workspace.id,
    knowledgeBundleId: LOCAL_GENERAL_BUNDLE_ID,
    title: "737NG AMM Electrical Power - ATA 24",
    fileType: "PDF",
    size: "42.8 MB",
    sizeBytes: 42_800_000,
    status: "processing",
    tags: ["737NG", "AMM", "ATA 24"],
    updatedAt: "Seeded demo",
    owner: "Maintenance Control",
    sourceType: "aviation",
    pages: 386,
    description:
      "Maintenance manual section staged for future extraction and topic review.",
    storageKey: null,
    originalFilename: "737ng-amm-electrical-power-ata-24.pdf",
    mimeType: "application/pdf",
    customProperties: [
      { key: "Manual family", value: "AMM" },
      { key: "ATA chapter", value: "24" },
    ],
    subjectFamily: "Boeing 737NG",
    documentType: "AMM",
    classificationCode: "24",
    effectivity: "737NG",
    sourceAuthority: "Boeing Aircraft Maintenance Manual",
    revision: "Seeded",
    extraction: createSeedExtraction("queued"),
  },
  {
    id: "doc-elt-training",
    workspaceId: workspace.id,
    knowledgeBundleId: LOCAL_GENERAL_BUNDLE_ID,
    title: "ELT System Training Notes",
    fileType: "PDF",
    size: "8.4 MB",
    sizeBytes: 8_400_000,
    status: "needs_review",
    tags: ["Training", "ELT", "ATA 23"],
    updatedAt: "Seeded demo",
    owner: "Training",
    sourceType: "aviation",
    pages: 64,
    description:
      "Training material that can explain system behavior but cannot authorize dispatch or procedure claims.",
    storageKey: null,
    originalFilename: "elt-system-training-notes.pdf",
    mimeType: "application/pdf",
    customProperties: [{ key: "Authority", value: "Training reference" }],
    subjectFamily: "Boeing 737NG",
    documentType: "Training",
    classificationCode: "23",
    effectivity: "737NG",
    sourceAuthority: "Training reference",
    revision: "Seeded",
    extraction: createSeedExtraction("queued"),
  },
  {
    id: "doc-company-policy",
    workspaceId: workspace.id,
    knowledgeBundleId: LOCAL_GENERAL_BUNDLE_ID,
    title: "Technical Publications Control Policy",
    fileType: "PDF",
    size: "2.1 MB",
    sizeBytes: 2_100_000,
    status: "ready",
    tags: ["Policy", "QA"],
    updatedAt: "Seeded demo",
    owner: "Quality",
    sourceType: "general",
    pages: 18,
    description:
      "Internal policy example for validating the platform beyond aviation manuals.",
    storageKey: null,
    originalFilename: "technical-publications-control-policy.pdf",
    mimeType: "application/pdf",
    customProperties: [{ key: "Department", value: "Quality" }],
    subjectFamily: null,
    documentType: "Policy",
    classificationCode: null,
    effectivity: "Company-wide",
    sourceAuthority: "Quality",
    revision: "Seeded",
    extraction: createSeedExtraction("queued"),
  },
  {
    id: "doc-apu-fault-routes",
    workspaceId: workspace.id,
    knowledgeBundleId: LOCAL_GENERAL_BUNDLE_ID,
    title: "APU Fault Route Reference",
    fileType: "PDF",
    size: "11.6 MB",
    sizeBytes: 11_600_000,
    status: "indexed",
    tags: ["APU", "ATA 49", "Routes"],
    updatedAt: "Seeded demo",
    owner: "Engineering",
    sourceType: "aviation",
    pages: 92,
    description:
      "Seeded route reference used to represent future OKF candidate generation.",
    storageKey: null,
    originalFilename: "apu-fault-route-reference.pdf",
    mimeType: "application/pdf",
    customProperties: [{ key: "Route type", value: "Fault isolation" }],
    subjectFamily: "Boeing 737NG",
    documentType: "Fault Route",
    classificationCode: "49",
    effectivity: "737NG",
    sourceAuthority: "Engineering",
    revision: "Seeded",
    extraction: createSeedExtraction("completed"),
  },
  {
    id: "doc-vendor-onboarding",
    workspaceId: workspace.id,
    knowledgeBundleId: LOCAL_GENERAL_BUNDLE_ID,
    title: "Vendor Onboarding Handbook",
    fileType: "PDF",
    size: "5.7 MB",
    sizeBytes: 5_700_000,
    status: "ready",
    tags: ["Vendor", "Handbook"],
    updatedAt: "Seeded demo",
    owner: "Operations",
    sourceType: "general",
    pages: 41,
    description:
      "General business document used to keep the platform domain-neutral.",
    storageKey: null,
    originalFilename: "vendor-onboarding-handbook.pdf",
    mimeType: "application/pdf",
    customProperties: [{ key: "Department", value: "Operations" }],
    subjectFamily: null,
    documentType: "Handbook",
    classificationCode: null,
    effectivity: "Company-wide",
    sourceAuthority: "Operations",
    revision: "Seeded",
    extraction: createSeedExtraction("completed"),
  },
  {
    id: "doc-mel-dispatch",
    workspaceId: workspace.id,
    knowledgeBundleId: LOCAL_GENERAL_BUNDLE_ID,
    title: "MEL Dispatch Gate Examples",
    fileType: "PDF",
    size: "19.3 MB",
    sizeBytes: 19_300_000,
    status: "blocked",
    tags: ["MEL", "Dispatch"],
    updatedAt: "Seeded demo",
    owner: "Maintenance Control",
    sourceType: "aviation",
    pages: 128,
    description:
      "Blocked seed item showing how unsupported or incomplete source metadata will surface.",
    storageKey: null,
    originalFilename: "mel-dispatch-gate-examples.pdf",
    mimeType: "application/pdf",
    customProperties: [{ key: "Authority", value: "Example only" }],
    subjectFamily: "Boeing 737NG",
    documentType: "MEL",
    classificationCode: null,
    effectivity: "737NG",
    sourceAuthority: "Example only",
    revision: "Seeded",
    extraction: {
      ...createSeedExtraction("failed"),
      error: {
        code: "incomplete_source_metadata",
        message: "Seeded blocked item is missing authoritative source metadata.",
      },
    },
  },
];

const seedActivityEvents: ActivityEvent[] = [
  {
    id: "act_1",
    label: "Extraction queued",
    documentTitle: "737NG AMM Electrical Power - ATA 24",
    timestamp: "Seeded",
    status: "processing",
  },
  {
    id: "act_2",
    label: "Reviewer requested",
    documentTitle: "ELT System Training Notes",
    timestamp: "Seeded",
    status: "needs_review",
  },
  {
    id: "act_3",
    label: "Metadata accepted",
    documentTitle: "Technical Publications Control Policy",
    timestamp: "Seeded",
    status: "ready",
  },
  {
    id: "act_4",
    label: "RAG index placeholder ready",
    documentTitle: "APU Fault Route Reference",
    timestamp: "Seeded",
    status: "indexed",
  },
];

const ATOMIC_RENAME_RETRIES = 6;

export function getCurrentUser() {
  return currentUser;
}

export function getCurrentWorkspace() {
  return workspace;
}

export function generateStorageKey(originalFilename: string) {
  void originalFilename;
  return `${randomUUID()}.pdf`;
}

export function assertPdfUpload(file: { name: string; size: number; type: string }) {
  const hasPdfName = file.name.toLowerCase().endsWith(".pdf");
  const hasPdfType = file.type === "application/pdf" || file.type === "";

  if (!hasPdfName || !hasPdfType) {
    throw new Error("only_pdf_uploads_supported");
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error("upload_exceeds_25mb_limit");
  }
}

export function assertPdfMagicBytes(bytes: Buffer) {
  if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error("invalid_pdf_magic_bytes");
  }
}

export function assertSafeStorageKey(storageKey: string, dataRoot: string) {
  const uploadRoot = path.resolve(dataRoot, "uploads");
  const targetPath = path.resolve(uploadRoot, storageKey);

  if (
    targetPath !== uploadRoot &&
    !targetPath.startsWith(`${uploadRoot}${path.sep}`)
  ) {
    throw new Error("target_escapes_root");
  }

  if (!/^[0-9a-f-]{36}\.pdf$/.test(storageKey)) {
    throw new Error("invalid_storage_key");
  }

  return targetPath;
}

export function parseTags(value: string) {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 12);
}

export function parseCustomProperties(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [rawKey, ...rawValue] = line.split(":");
      return {
        key: rawKey.trim(),
        value: rawValue.join(":").trim(),
      };
    })
    .filter((property) => property.key.length > 0 && property.value.length > 0)
    .slice(0, 16);
}

export function customPropertiesToText(properties: CustomProperty[]) {
  return properties
    .map((property) => `${property.key}: ${property.value}`)
    .join("\n");
}

export function createLocalDocumentVault(dataRoot = getDefaultDataRoot()) {
  const root = path.resolve(dataRoot);
  const storePath = path.join(root, "document-vault.json");
  const uploadsPath = path.join(root, "uploads");
  let writeQueue = Promise.resolve();

  async function ensureStore() {
    await mkdir(uploadsPath, { recursive: true });

    try {
      await readFile(storePath, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        await writeStoreAtomic({
          documents: seedDocuments,
          activityEvents: seedActivityEvents,
          topicEnrichmentAudits: [],
          topicRecords: [],
        });
        return;
      }

      throw error;
    }
  }

  async function readStore(): Promise<VaultStore> {
    await ensureStore();
    const rawStore = await readFile(storePath, "utf8");
    const store = JSON.parse(rawStore) as VaultStore;
    store.topicEnrichmentAudits ??= [];
    store.topicRecords ??= [];
    return store;
  }

  async function writeStoreAtomic(store: VaultStore) {
    await mkdir(root, { recursive: true });
    const tempPath = `${storePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(store, null, 2)}\n`);
    await renameWithRetry(tempPath, storePath);
  }

  async function mutateStore<T>(mutation: (store: VaultStore) => Promise<T>) {
    const run = async () => {
      const store = await readStore();
      const result = await mutation(store);
      await writeStoreAtomic(store);
      return result;
    };

    const pending = writeQueue.then(run, run);
    writeQueue = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }

  async function createUploadedDocument(input: UploadMetadata) {
    assertPdfUpload({
      name: input.originalFilename,
      size: input.bytes.byteLength,
      type: input.type,
    });
    assertPdfMagicBytes(input.bytes);

    const storageKey = generateStorageKey(input.originalFilename);
    const targetPath = assertSafeStorageKey(storageKey, root);
    await mkdir(uploadsPath, { recursive: true });
    await writeFile(targetPath, input.bytes);

    return mutateStore(async (store) => {
      const document: Document = {
        id: `doc-${randomUUID()}`,
        workspaceId: workspace.id,
        knowledgeBundleId: input.knowledgeBundleId,
        title: input.title.trim() || input.originalFilename.replace(/\.pdf$/i, ""),
        fileType: "PDF",
        size: formatBytes(input.bytes.byteLength),
        sizeBytes: input.bytes.byteLength,
        status: "processing",
        tags: input.tags,
        updatedAt: formatTimestamp(new Date()),
        owner: input.owner.trim() || "Unassigned",
        sourceType: input.sourceType,
        pages: 0,
        description: input.description.trim(),
        storageKey,
        originalFilename: input.originalFilename,
        mimeType: "application/pdf",
        customProperties: [],
        subjectFamily: null,
        documentType: null,
        classificationCode: null,
        effectivity: null,
        sourceAuthority: null,
        revision: null,
        extraction: {
          status: "queued",
          startedAt: null,
          completedAt: null,
          error: null,
          pageRecords: [],
          logs: [createExtractionLog("info", "Extraction queued after upload.")],
        },
      };

      store.documents.unshift(document);
      store.activityEvents.unshift({
        id: `act-${randomUUID()}`,
        label: "PDF uploaded",
        documentTitle: document.title,
        timestamp: "Just now",
        status: document.status,
      });

      return document;
    });
  }

  async function updateDocumentMetadata(id: string, input: UpdateMetadata) {
    return mutateStore(async (store) => {
      const document = getStoreDocument(store, id);

      document.title = input.title.trim() || document.title;
      document.subjectFamily = normalizeOptionalMetadata(input.subjectFamily);
      document.documentType = normalizeOptionalMetadata(input.documentType);
      document.classificationCode = normalizeOptionalMetadata(
        input.classificationCode,
      );
      document.effectivity = normalizeOptionalMetadata(input.effectivity);
      document.sourceAuthority = normalizeOptionalMetadata(input.sourceAuthority);
      document.revision = normalizeOptionalMetadata(input.revision);
      document.owner = input.owner.trim() || "Unassigned";
      document.sourceType = input.sourceType;
      document.status = input.status;
      document.tags = input.tags;
      document.description = input.description.trim();
      document.customProperties = input.customProperties;
      document.updatedAt = formatTimestamp(new Date());

      store.activityEvents.unshift({
        id: `act-${randomUUID()}`,
        label: "Metadata updated",
        documentTitle: document.title,
        timestamp: "Just now",
        status: document.status,
      });

      return document;
    });
  }

  async function startExtraction(id: string) {
    return mutateStore(async (store) => {
      const document = getStoreDocument(store, id);
      const timestamp = formatTimestamp(new Date());

      document.status = "processing";
      document.extraction = normalizeExtraction(document.extraction);
      document.extraction.status = "running";
      document.extraction.startedAt = timestamp;
      document.extraction.completedAt = null;
      document.extraction.error = null;
      document.extraction.logs.push(
        createExtractionLog("info", "Extraction started."),
      );
      document.updatedAt = timestamp;

      store.activityEvents.unshift({
        id: `act-${randomUUID()}`,
        label: "Extraction started",
        documentTitle: document.title,
        timestamp: "Just now",
        status: document.status,
      });

      return document;
    });
  }

  async function completeExtraction(id: string, input: CompleteExtractionInput) {
    return mutateStore(async (store) => {
      const document = getStoreDocument(store, id);
      const timestamp = formatTimestamp(new Date());

      document.status = "ready";
      document.pages = input.pageRecords.length;
      document.extraction = normalizeExtraction(document.extraction);
      document.extraction.status = "completed";
      document.extraction.completedAt = timestamp;
      document.extraction.error = null;
      document.extraction.pageRecords = input.pageRecords;
      document.extraction.logs.push(
        createExtractionLog(
          "info",
          `Extraction completed with ${input.pageRecords.length} page records.`,
        ),
      );
      document.updatedAt = timestamp;

      store.activityEvents.unshift({
        id: `act-${randomUUID()}`,
        label: "Extraction completed",
        documentTitle: document.title,
        timestamp: "Just now",
        status: document.status,
      });

      return document;
    });
  }

  async function failExtraction(id: string, error: ExtractionError) {
    return mutateStore(async (store) => {
      const document = getStoreDocument(store, id);
      const timestamp = formatTimestamp(new Date());

      document.status = "blocked";
      document.extraction = normalizeExtraction(document.extraction);
      document.extraction.status = "failed";
      document.extraction.completedAt = timestamp;
      document.extraction.error = error;
      document.extraction.logs.push(createExtractionLog("error", error.message));
      document.updatedAt = timestamp;

      store.activityEvents.unshift({
        id: `act-${randomUUID()}`,
        label: "Extraction failed",
        documentTitle: document.title,
        timestamp: "Just now",
        status: document.status,
      });

      return document;
    });
  }

  async function getDocumentPdfBytes(id: string) {
    const document = await (async () => {
      const store = await readStore();
      return getStoreDocument(store, id);
    })();

    if (!document.storageKey) {
      throw new Error("document_has_no_stored_pdf");
    }

    const targetPath = assertSafeStorageKey(document.storageKey, root);
    return readFile(targetPath);
  }

  async function generateTopicRecords(id: string) {
    return mutateStore(async (store) => {
      const document = getStoreDocument(store, id);

      if (document.extraction.status !== "completed") {
        throw new Error("document_extraction_not_completed");
      }

      store.topicRecords ??= [];

      const preservedTopics = store.topicRecords.filter(
        (topic) =>
          topic.documentId === id &&
          (topic.reviewStatus === "approved" || topic.reviewStatus === "rejected"),
      );
      const otherDocumentsTopics = store.topicRecords.filter(
        (topic) => topic.documentId !== id,
      );
      const candidates = generateTopicCandidates(
        id,
        document.extraction.pageRecords,
      );
      const timestamp = formatTimestamp(new Date());
      const newTopics = candidates
        .filter(
          (candidate) =>
            !preservedTopics.some((topic) =>
              pagesOverlap(topic.sourcePageNumbers, candidate.sourcePageNumbers),
            ),
        )
        .map((candidate): TopicRecord => ({
          ...candidate,
          id: `topic-${randomUUID()}`,
          knowledgeBundleId: document.knowledgeBundleId,
          originalTitle: candidate.title,
          originalSummary: candidate.summary,
          approvedContentSource: null,
          enrichedAt: null,
          enrichedSummary: null,
          enrichedBody: null,
          proposedSourcePageNumbers: [],
          discoveryMetadata: { version: "legacy-heading-v1" },
          enrichedTitle: null,
          enrichmentErrorMessage: null,
          enrichmentModel: null,
          enrichmentStatus: "none",
          editedAt: null,
          editedBy: null,
          reviewStatus: "needs_review",
          relations: [],
          okfMetadata: {},
          exportedFilePath: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        }));

      store.topicRecords = [...otherDocumentsTopics, ...preservedTopics, ...newTopics];
      store.activityEvents.unshift({
        id: `act-${randomUUID()}`,
        label: "Topic records generated",
        documentTitle: document.title,
        timestamp: "Just now",
        status: document.status,
      });

      return [...preservedTopics, ...newTopics];
    });
  }

  async function updateTopicReviewStatus(
    topicId: string,
    reviewStatus: TopicReviewStatus,
  ) {
    return mutateStore(async (store) => {
      store.topicRecords ??= [];
      const topic = store.topicRecords.find((candidate) => candidate.id === topicId);

      if (!topic) {
        throw new Error("topic_not_found");
      }

      topic.reviewStatus = reviewStatus;
      topic.updatedAt = formatTimestamp(new Date());
      return normalizeTopicRecord(topic, store.topicEnrichmentAudits);
    });
  }

  async function updateTopicRelations(topicId: string, relations: TopicRelation[]) {
    return mutateStore(async (store) => {
      store.topicRecords ??= [];
      const topic = getStoreTopic(store, topicId);

      if (topic.reviewStatus !== "approved") {
        throw new Error("topic_relations_require_approved_topic");
      }

      topic.relations = relations;
      topic.updatedAt = formatTimestamp(new Date());
      return normalizeTopicRecord(topic, store.topicEnrichmentAudits);
    });
  }

  async function updateTopicExportedFilePath(
    topicId: string,
    exportedFilePath: string,
  ) {
    return mutateStore(async (store) => {
      store.topicRecords ??= [];
      const topic = getStoreTopic(store, topicId);

      topic.exportedFilePath = exportedFilePath;
      topic.updatedAt = formatTimestamp(new Date());
      return normalizeTopicRecord(topic, store.topicEnrichmentAudits);
    });
  }

  async function updateTopicContent(
    topicId: string,
    input: UpdateTopicContentInput,
  ) {
    return mutateStore(async (store) => {
      store.topicRecords ??= [];
      const topic = getStoreTopic(store, topicId);

      if (topic.reviewStatus === "approved") {
        throw new Error("topic_content_edit_requires_unapproved_topic");
      }

      const nextTitle = input.title === undefined ? topic.title : input.title.trim();
      const nextSummary =
        input.summary === undefined ? topic.summary : input.summary.trim();

      if (nextTitle.length === 0) {
        throw new Error("topic_title_required");
      }

      const changed = nextTitle !== topic.title || nextSummary !== topic.summary;
      topic.title = nextTitle;
      topic.summary = nextSummary;

      if (changed) {
        topic.editedAt = formatTimestamp(new Date());
        topic.editedBy = input.editedBy;
        topic.updatedAt = formatTimestamp(new Date());
      }

      return normalizeTopicRecord(topic, store.topicEnrichmentAudits);
    });
  }

  async function updateTopicOkfMetadata(
    topicId: string,
    okfMetadata: Record<string, unknown>,
  ) {
    return mutateStore(async (store) => {
      const topic = getStoreTopic(store, topicId);
      if (topic.reviewStatus === "approved") {
        throw new Error("topic_metadata_edit_requires_unapproved_topic");
      }
      topic.okfMetadata = okfMetadata;
      topic.updatedAt = formatTimestamp(new Date());
      return normalizeTopicRecord(topic, store.topicEnrichmentAudits);
    });
  }

  async function getTopicEnrichmentInput(topicId: string) {
    const store = await readStore();
    const topic = getStoreTopic(store, topicId);
    const document = getStoreDocument(store, topic.documentId);
    return {
      sourcePages: document.extraction.pageRecords.filter(
        (pageRecord) =>
          pageRecord.pageNumber >= Math.max(1, topic.pageStart - 2) &&
          pageRecord.pageNumber <= topic.pageEnd + 2,
      ),
      topic: normalizeTopicRecord(topic, store.topicEnrichmentAudits),
    };
  }

  async function markTopicEnrichmentPending(topicId: string) {
    return mutateStore(async (store) => {
      const topic = getStoreTopic(store, topicId);
      if (topic.reviewStatus === "approved") {
        throw new Error("topic_enrichment_requires_unapproved_topic");
      }
      topic.enrichmentStatus = "pending";
      topic.enrichmentErrorMessage = null;
      topic.updatedAt = formatTimestamp(new Date());
      return normalizeTopicRecord(topic, store.topicEnrichmentAudits);
    });
  }

  async function completeTopicEnrichment(
    topicId: string,
    input: {
      enrichedSummary: string;
      enrichedTitle: string;
      enrichedBody?: string;
      proposedSourcePageNumbers?: number[];
      model: string;
      promptSent: string;
      provider: string;
      rawResponse: string;
      requestedBy: string;
    },
  ) {
    return mutateStore(async (store) => {
      store.topicEnrichmentAudits ??= [];
      const topic = getStoreTopic(store, topicId);
      const createdAt = formatTimestamp(new Date());
      store.topicEnrichmentAudits.push({
        id: `audit-${randomUUID()}`,
        createdAt,
        errorMessage: null,
        model: input.model,
        promptSent: input.promptSent,
        provider: input.provider,
        rawResponse: input.rawResponse,
        requestedBy: input.requestedBy,
        succeeded: true,
        topicId,
      });
      topic.enrichedTitle = input.enrichedTitle;
      topic.enrichedSummary = input.enrichedSummary;
      topic.enrichedBody = input.enrichedBody ?? input.enrichedSummary;
      topic.proposedSourcePageNumbers = input.proposedSourcePageNumbers ?? [];
      topic.enrichmentStatus = "completed";
      topic.enrichmentErrorMessage = null;
      topic.enrichmentModel = input.model;
      topic.enrichedAt = createdAt;
      topic.updatedAt = createdAt;
      return normalizeTopicRecord(topic, store.topicEnrichmentAudits);
    });
  }

  async function failTopicEnrichment(
    topicId: string,
    input: {
      errorMessage: string;
      model: string;
      promptSent: string;
      provider: string;
      rawResponse: string;
      requestedBy: string;
    },
  ) {
    return mutateStore(async (store) => {
      store.topicEnrichmentAudits ??= [];
      const topic = getStoreTopic(store, topicId);
      const createdAt = formatTimestamp(new Date());
      store.topicEnrichmentAudits.push({
        id: `audit-${randomUUID()}`,
        createdAt,
        errorMessage: input.errorMessage,
        model: input.model,
        promptSent: input.promptSent,
        provider: input.provider,
        rawResponse: input.rawResponse,
        requestedBy: input.requestedBy,
        succeeded: false,
        topicId,
      });
      topic.enrichmentStatus = "failed";
      topic.enrichmentErrorMessage = input.errorMessage;
      topic.updatedAt = createdAt;
      return normalizeTopicRecord(topic, store.topicEnrichmentAudits);
    });
  }

  async function approveTopicContent(
    topicId: string,
    approvedContentSource: ApprovedContentSource,
  ) {
    return mutateStore(async (store) => {
      const topic = getStoreTopic(store, topicId);
      if (topic.reviewStatus === "approved") {
        throw new Error("topic_already_approved");
      }
      if (approvedContentSource === "enriched") {
        if (!topic.enrichedTitle || !topic.enrichedSummary) {
          throw new Error("topic_enrichment_required_for_approval");
        }
        topic.title = topic.enrichedTitle;
        topic.summary = topic.enrichedSummary;
      }
      topic.approvedContentSource = approvedContentSource;
      topic.reviewStatus = "approved";
      topic.updatedAt = formatTimestamp(new Date());
      return normalizeTopicRecord(topic, store.topicEnrichmentAudits);
    });
  }

  return {
    completeExtraction,
    completeTopicEnrichment,
    approveTopicContent,
    createUploadedDocument,
    failExtraction,
    failTopicEnrichment,
    getActivityEvents: async () => (await readStore()).activityEvents,
    getDocumentById: async (id: string) => {
      const document = (await readStore()).documents.find(
        (candidate) => candidate.id === id,
      );
      if (document) {
        normalizeDocument(document);
      }
      return document;
    },
    getDocumentMetrics: async () =>
      calculateDocumentMetrics((await readStore()).documents),
    getDocumentPdfBytes,
    getDocuments: async () => normalizeDocuments((await readStore()).documents),
    getRecentDocuments: async (limit = 4) =>
      normalizeDocuments((await readStore()).documents).slice(0, limit),
    getTopicRecordsByDocumentId: async (id: string) =>
      await (async () => {
        const store = await readStore();
        return (store.topicRecords ?? [])
          .filter((topic) => topic.documentId === id)
          .map((topic) => normalizeTopicRecord(topic, store.topicEnrichmentAudits));
      })(),
    getTopicEnrichmentInput,
    generateTopicRecords,
    markTopicEnrichmentPending,
    startExtraction,
    updateTopicReviewStatus,
    updateTopicRelations,
    updateTopicExportedFilePath,
    updateTopicContent,
    updateTopicOkfMetadata,
    updateDocumentMetadata,
  };
}

const defaultVault = createLocalDocumentVault();

export async function getDocuments() {
  return defaultVault.getDocuments();
}

export async function getRecentDocuments(limit = 4) {
  return defaultVault.getRecentDocuments(limit);
}

export async function getActivityEvents() {
  return defaultVault.getActivityEvents();
}

export async function getDocumentById(id: string) {
  return defaultVault.getDocumentById(id);
}

export async function getDocumentMetrics() {
  return defaultVault.getDocumentMetrics();
}

export async function createUploadedDocument(input: UploadMetadata) {
  return defaultVault.createUploadedDocument(input);
}

export async function updateDocumentMetadata(id: string, input: UpdateMetadata) {
  return defaultVault.updateDocumentMetadata(id, input);
}

export async function startExtraction(id: string) {
  return defaultVault.startExtraction(id);
}

export async function completeExtraction(
  id: string,
  input: CompleteExtractionInput,
) {
  return defaultVault.completeExtraction(id, input);
}

export async function failExtraction(id: string, error: ExtractionError) {
  return defaultVault.failExtraction(id, error);
}

export async function getDocumentPdfBytes(id: string) {
  return defaultVault.getDocumentPdfBytes(id);
}

export async function getTopicRecordsByDocumentId(id: string) {
  return defaultVault.getTopicRecordsByDocumentId(id);
}

export async function generateTopicRecords(id: string) {
  return defaultVault.generateTopicRecords(id);
}

export async function updateTopicReviewStatus(
  topicId: string,
  reviewStatus: TopicReviewStatus,
) {
  return defaultVault.updateTopicReviewStatus(topicId, reviewStatus);
}

export async function updateTopicRelations(
  topicId: string,
  relations: TopicRelation[],
) {
  return defaultVault.updateTopicRelations(topicId, relations);
}

export async function updateTopicExportedFilePath(
  topicId: string,
  exportedFilePath: string,
) {
  return defaultVault.updateTopicExportedFilePath(topicId, exportedFilePath);
}

export async function updateTopicContent(
  topicId: string,
  input: UpdateTopicContentInput,
) {
  return defaultVault.updateTopicContent(topicId, input);
}

export async function updateTopicOkfMetadata(
  topicId: string,
  okfMetadata: Record<string, unknown>,
) {
  return defaultVault.updateTopicOkfMetadata(topicId, okfMetadata);
}

export async function getTopicEnrichmentInput(topicId: string) {
  return defaultVault.getTopicEnrichmentInput(topicId);
}

export async function markTopicEnrichmentPending(topicId: string) {
  return defaultVault.markTopicEnrichmentPending(topicId);
}

export async function completeTopicEnrichment(
  topicId: string,
  input: Parameters<typeof defaultVault.completeTopicEnrichment>[1],
) {
  return defaultVault.completeTopicEnrichment(topicId, input);
}

export async function failTopicEnrichment(
  topicId: string,
  input: Parameters<typeof defaultVault.failTopicEnrichment>[1],
) {
  return defaultVault.failTopicEnrichment(topicId, input);
}

export async function approveTopicContent(
  topicId: string,
  approvedContentSource: ApprovedContentSource,
) {
  return defaultVault.approveTopicContent(topicId, approvedContentSource);
}

export function getDefaultDataRoot() {
  const configuredDataRoot = process.env.AV_OKF_DATA_ROOT;

  if (configuredDataRoot) {
    return path.resolve(configuredDataRoot);
  }

  return path.join(process.cwd(), ".data");
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTimestamp(date: Date) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

async function renameWithRetry(sourcePath: string, targetPath: string) {
  for (let attempt = 0; attempt <= ATOMIC_RENAME_RETRIES; attempt += 1) {
    try {
      await rename(sourcePath, targetPath);
      return;
    } catch (error) {
      const canRetry =
        isNodeError(error) &&
        (error.code === "EPERM" || error.code === "EBUSY") &&
        attempt < ATOMIC_RENAME_RETRIES;

      if (!canRetry) {
        throw error;
      }

      await delay(25 * (attempt + 1));
    }
  }
}

function getStoreDocument(store: VaultStore, id: string) {
  const document = store.documents.find((candidate) => candidate.id === id);

  if (!document) {
    throw new Error("document_not_found");
  }

  document.extraction = normalizeExtraction(document.extraction);
  return document;
}

function getStoreTopic(store: VaultStore, id: string) {
  const topic = (store.topicRecords ?? []).find((candidate) => candidate.id === id);

  if (!topic) {
    throw new Error("topic_not_found");
  }

  return normalizeTopicRecord(topic);
}

function normalizeTopicRecord(
  topic: TopicRecord,
  audits: TopicEnrichmentAudit[] = [],
): TopicRecord {
  topic.knowledgeBundleId ??= LOCAL_GENERAL_BUNDLE_ID;
  topic.okfMetadata ??= {};
  topic.originalTitle ??= topic.title;
  topic.originalSummary ??= topic.summary;
  topic.editedAt ??= null;
  topic.editedBy ??= null;
  topic.enrichedTitle ??= null;
  topic.enrichedSummary ??= null;
  topic.enrichedBody ??= null;
  topic.proposedSourcePageNumbers ??= [];
  topic.discoveryMetadata ??= { version: "legacy-heading-v1" };
  topic.enrichmentStatus ??= "none";
  topic.approvedContentSource ??= null;
  topic.exportedFilePath ??= null;
  const topicAudits = audits
    .filter((audit) => audit.topicId === topic.id)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const latestAudit = topicAudits.at(-1);
  const latestSuccess = topicAudits.filter((audit) => audit.succeeded).at(-1);
  topic.enrichedAt ??= latestSuccess?.createdAt ?? null;
  topic.enrichmentModel ??= latestSuccess?.model ?? null;
  topic.enrichmentErrorMessage ??=
    topic.enrichmentStatus === "failed"
      ? latestAudit?.errorMessage ?? null
      : null;
  topic.relations = normalizeTopicRelations(topic.relations);
  return topic;
}

function createSeedExtraction(status: ExtractionStatus): DocumentExtraction {
  return {
    status,
    startedAt: null,
    completedAt: null,
    error: null,
    pageRecords: [],
    logs: [createExtractionLog("info", `Seeded extraction state: ${status}.`)],
  };
}

function normalizeExtraction(
  extraction: DocumentExtraction | undefined,
): DocumentExtraction {
  return (
    extraction ?? {
      status: "queued",
      startedAt: null,
      completedAt: null,
      error: null,
      pageRecords: [],
      logs: [],
    }
  );
}

function createExtractionLog(
  level: ExtractionLog["level"],
  message: string,
): ExtractionLog {
  return {
    id: `log-${randomUUID()}`,
    timestamp: formatTimestamp(new Date()),
    level,
    message,
  };
}

function normalizeDocuments(documents: Document[]) {
  return documents.map((document) => normalizeDocument({ ...document }));
}

function pagesOverlap(left: number[], right: number[]) {
  const rightPages = new Set(right);
  return left.some((pageNumber) => rightPages.has(pageNumber));
}

function calculateDocumentMetrics(documents: Document[]): DocumentMetrics {
  return {
    total: documents.length,
    processing: documents.filter((document) => document.status === "processing")
      .length,
    ready: documents.filter(
      (document) => document.status === "ready" || document.status === "indexed",
    ).length,
    review: documents.filter((document) => document.status === "needs_review")
      .length,
  };
}

function normalizeDocument(document: Document): Document {
  document.knowledgeBundleId ??= LOCAL_GENERAL_BUNDLE_ID;
  document.extraction = normalizeExtraction(document.extraction);
  document.subjectFamily ??= null;
  document.documentType ??= null;
  document.classificationCode ??= null;
  document.effectivity ??= null;
  document.sourceAuthority ??= null;
  document.revision ??= null;
  return document;
}

function normalizeOptionalMetadata(value: string | null) {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

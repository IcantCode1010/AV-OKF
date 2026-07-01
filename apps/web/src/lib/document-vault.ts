import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

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

export type Document = {
  id: string;
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
  extraction: DocumentExtraction;
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
};

type UploadMetadata = {
  bytes: Buffer;
  description: string;
  originalFilename: string;
  owner: string;
  sourceType: SourceType;
  tags: string[];
  title: string;
  type: string;
};

type UpdateMetadata = {
  description: string;
  owner: string;
  sourceType: SourceType;
  status: DocumentStatus;
  tags: string[];
  title: string;
  customProperties: CustomProperty[];
};

type CompleteExtractionInput = {
  pageRecords: ExtractedPageRecord[];
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
    extraction: createSeedExtraction("queued"),
  },
  {
    id: "doc-elt-training",
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
    extraction: createSeedExtraction("queued"),
  },
  {
    id: "doc-company-policy",
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
    extraction: createSeedExtraction("queued"),
  },
  {
    id: "doc-apu-fault-routes",
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
    extraction: createSeedExtraction("completed"),
  },
  {
    id: "doc-vendor-onboarding",
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
    extraction: createSeedExtraction("completed"),
  },
  {
    id: "doc-mel-dispatch",
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
        });
        return;
      }

      throw error;
    }
  }

  async function readStore(): Promise<VaultStore> {
    await ensureStore();
    const rawStore = await readFile(storePath, "utf8");
    return JSON.parse(rawStore) as VaultStore;
  }

  async function writeStoreAtomic(store: VaultStore) {
    await mkdir(root, { recursive: true });
    const tempPath = `${storePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(store, null, 2)}\n`);
    await rename(tempPath, storePath);
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
      const document = store.documents.find((candidate) => candidate.id === id);

      if (!document) {
        throw new Error("document_not_found");
      }

      document.title = input.title.trim() || document.title;
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

  return {
    completeExtraction,
    createUploadedDocument,
    failExtraction,
    getActivityEvents: async () => (await readStore()).activityEvents,
    getDocumentById: async (id: string) => {
      const document = (await readStore()).documents.find(
        (candidate) => candidate.id === id,
      );
      if (document) {
        document.extraction = normalizeExtraction(document.extraction);
      }
      return document;
    },
    getDocumentMetrics: async () =>
      calculateDocumentMetrics((await readStore()).documents),
    getDocumentPdfBytes,
    getDocuments: async () => normalizeDocuments((await readStore()).documents),
    getRecentDocuments: async (limit = 4) =>
      normalizeDocuments((await readStore()).documents).slice(0, limit),
    startExtraction,
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

function getDefaultDataRoot() {
  return path.resolve(process.cwd(), ".data");
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

function getStoreDocument(store: VaultStore, id: string) {
  const document = store.documents.find((candidate) => candidate.id === id);

  if (!document) {
    throw new Error("document_not_found");
  }

  document.extraction = normalizeExtraction(document.extraction);
  return document;
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
  return documents.map((document) => ({
    ...document,
    extraction: normalizeExtraction(document.extraction),
  }));
}

function calculateDocumentMetrics(documents: Document[]) {
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

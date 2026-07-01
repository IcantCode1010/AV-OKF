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

export type Document = {
  id: string;
  title: string;
  fileType: string;
  size: string;
  status: DocumentStatus;
  tags: string[];
  updatedAt: string;
  owner: string;
  sourceType: "aviation" | "general";
  pages: number;
  description: string;
};

export type ActivityEvent = {
  id: string;
  label: string;
  documentTitle: string;
  timestamp: string;
  status: DocumentStatus;
};

export const currentUser: User = {
  id: "usr_demo",
  name: "Ellis Carter",
  email: "ellis@example.com",
  initials: "EC",
  role: "Workspace Admin",
};

export const workspace: Workspace = {
  id: "wrk_av_okf",
  name: "AV-OKF Demo Workspace",
  plan: "Stage 1 Local Vault",
  memberCount: 4,
};

export const documents: Document[] = [
  {
    id: "doc-737ng-amm-24",
    title: "737NG AMM Electrical Power - ATA 24",
    fileType: "PDF",
    size: "42.8 MB",
    status: "processing",
    tags: ["737NG", "AMM", "ATA 24"],
    updatedAt: "Today, 09:42",
    owner: "Maintenance Control",
    sourceType: "aviation",
    pages: 386,
    description:
      "Maintenance manual section staged for future extraction and topic review.",
  },
  {
    id: "doc-elt-training",
    title: "ELT System Training Notes",
    fileType: "PDF",
    size: "8.4 MB",
    status: "needs_review",
    tags: ["Training", "ELT", "ATA 23"],
    updatedAt: "Yesterday, 16:18",
    owner: "Training",
    sourceType: "aviation",
    pages: 64,
    description:
      "Training material that can explain system behavior but cannot authorize dispatch or procedure claims.",
  },
  {
    id: "doc-company-policy",
    title: "Technical Publications Control Policy",
    fileType: "PDF",
    size: "2.1 MB",
    status: "ready",
    tags: ["Policy", "QA"],
    updatedAt: "Mon, 13:05",
    owner: "Quality",
    sourceType: "general",
    pages: 18,
    description:
      "Internal policy example for validating the platform beyond aviation manuals.",
  },
  {
    id: "doc-apu-fault-routes",
    title: "APU Fault Route Reference",
    fileType: "PDF",
    size: "11.6 MB",
    status: "indexed",
    tags: ["APU", "ATA 49", "Routes"],
    updatedAt: "Jun 28, 10:11",
    owner: "Engineering",
    sourceType: "aviation",
    pages: 92,
    description:
      "Seeded route reference used to represent future OKF candidate generation.",
  },
  {
    id: "doc-vendor-onboarding",
    title: "Vendor Onboarding Handbook",
    fileType: "PDF",
    size: "5.7 MB",
    status: "ready",
    tags: ["Vendor", "Handbook"],
    updatedAt: "Jun 26, 08:33",
    owner: "Operations",
    sourceType: "general",
    pages: 41,
    description:
      "General business document used to keep the platform domain-neutral.",
  },
  {
    id: "doc-mel-dispatch",
    title: "MEL Dispatch Gate Examples",
    fileType: "PDF",
    size: "19.3 MB",
    status: "blocked",
    tags: ["MEL", "Dispatch"],
    updatedAt: "Jun 25, 14:49",
    owner: "Maintenance Control",
    sourceType: "aviation",
    pages: 128,
    description:
      "Blocked seed item showing how unsupported or incomplete source metadata will surface.",
  },
];

export const activityEvents: ActivityEvent[] = [
  {
    id: "act_1",
    label: "Extraction queued",
    documentTitle: "737NG AMM Electrical Power - ATA 24",
    timestamp: "5 min ago",
    status: "processing",
  },
  {
    id: "act_2",
    label: "Reviewer requested",
    documentTitle: "ELT System Training Notes",
    timestamp: "1 hr ago",
    status: "needs_review",
  },
  {
    id: "act_3",
    label: "Metadata accepted",
    documentTitle: "Technical Publications Control Policy",
    timestamp: "3 hrs ago",
    status: "ready",
  },
  {
    id: "act_4",
    label: "RAG index placeholder ready",
    documentTitle: "APU Fault Route Reference",
    timestamp: "Yesterday",
    status: "indexed",
  },
];

export function getCurrentUser() {
  return currentUser;
}

export function getCurrentWorkspace() {
  return workspace;
}

export function getDocuments() {
  return documents;
}

export function getRecentDocuments(limit = 4) {
  return documents.slice(0, limit);
}

export function getActivityEvents() {
  return activityEvents;
}

export function getDocumentById(id: string) {
  return documents.find((document) => document.id === id);
}

export function getDocumentMetrics() {
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

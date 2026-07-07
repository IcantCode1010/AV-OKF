import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { DocumentExtractionPoller } from "@/components/document-extraction-poller";
import {
  DocumentExtractionPanel,
  DocumentLogsPanel,
  DocumentMetadataPanel,
  DocumentSummaryPanel,
  TopicWorkflowPanel,
} from "@/components/document-detail/document-detail-panels";
import { DocumentTreeNav } from "@/components/document-tree-nav";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  getDocumentById,
  getTopicRecordsByDocumentId,
  type Document,
  type TopicRecord,
} from "@/lib/document-backend";
import { getOkfConceptLifecycleByFile } from "@/lib/okf-lifecycle";
import type { OkfConceptLifecycleRecord } from "@/lib/okf-bundle-retriever";
import {
  getDefaultKnowledgeRoot,
  listOkfBundleFiles,
} from "@/lib/okf-bundle";
import { formatOkfExportError } from "@/lib/okf-export-errors";
import { getAllowedRelations } from "@/lib/okf-relation-vocabulary";
import { runExtractionAction } from "../actions";

export const dynamic = "force-dynamic";

const documentPanels = ["summary", "metadata", "extraction", "topics", "logs"];

export default async function DocumentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    deleteError?: string;
    enrichmentError?: string;
    lifecycleError?: string;
    lifecycleUpdated?: string;
    metadataError?: string;
    okfExportError?: string;
    panel?: string;
    relationError?: string;
    topic?: string;
    topicsGenerated?: string;
  }>;
}) {
  const { id } = await params;
  const {
    deleteError,
    enrichmentError,
    lifecycleError,
    lifecycleUpdated,
    metadataError,
    okfExportError,
    panel,
    relationError,
    topic: topicId,
    topicsGenerated,
  } = await searchParams;
  const knowledgeRoot = getDefaultKnowledgeRoot();
  const [document, topicRecords, allowedRelations, relationTargets] =
    await Promise.all([
      getDocumentById(id),
      getTopicRecordsByDocumentId(id),
      getAllowedRelations(),
      getRelationTargets(knowledgeRoot),
    ]);

  if (!document) {
    notFound();
  }

  const currentDocument = document;
  const activePanel = resolvePanel(
    panel,
    topicRecords.length,
    currentDocument.extraction.status,
  );
  const selectedTopic =
    activePanel === "topics"
      ? topicRecords.find((topic) => topic.id === topicId) ??
        topicRecords[0] ??
        null
      : null;
  const topicLifecycleById = await resolveTopicLifecycles({
    document: currentDocument,
    topics: topicRecords,
  });
  const selectedTopicLifecycle = selectedTopic
    ? topicLifecycleById.get(selectedTopic.id) ?? { status: "active" as const }
    : { status: "active" as const };
  const relationErrorMessage = formatRelationError(relationError);
  const enrichmentErrorMessage = formatEnrichmentError(enrichmentError);
  const deleteErrorMessage = formatDeleteError(deleteError);
  const metadataErrorMessage = formatMetadataError(metadataError);
  const lifecycleErrorMessage = formatLifecycleError(lifecycleError);
  const lifecycleUpdatedMessage = formatLifecycleUpdated(lifecycleUpdated);
  const okfExportErrorMessage = formatOkfExportError(okfExportError);

  return (
    <>
      <DocumentExtractionPoller status={currentDocument.extraction.status} />
      <div className="space-y-4">
        <Button asChild variant="ghost" className="w-fit px-0">
          <Link href="/documents">
            <ArrowLeft className="h-4 w-4" />
            Back to documents
          </Link>
        </Button>

        <header className="rounded-lg border border-border bg-card p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{currentDocument.fileType}</Badge>
                <StatusBadge status={currentDocument.status} />
                <Badge variant="outline" className="capitalize">
                  extraction {currentDocument.extraction.status}
                </Badge>
                <Badge variant="outline">{topicRecords.length} topics</Badge>
              </div>
              <h1 className="mt-3 text-2xl font-semibold tracking-tight md:text-3xl">
                {currentDocument.title}
              </h1>
              <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                {currentDocument.description}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {formatExtractionActivity(currentDocument.extraction)}
              </p>
            </div>
            {currentDocument.storageKey ? (
              <form action={runExtractionAction}>
                <input type="hidden" name="id" value={currentDocument.id} />
                <PendingSubmitButton pendingLabel="Starting...">
                  Run extraction
                </PendingSubmitButton>
              </form>
            ) : (
              <Button disabled>Seed document has no stored PDF</Button>
            )}
          </div>
        </header>

        <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="space-y-3 lg:sticky lg:top-4 lg:self-start">
            <DocumentTreeNav
              activePanel={activePanel}
              activeTopicId={selectedTopic?.id ?? null}
              documentId={currentDocument.id}
              key={`${activePanel}-${selectedTopic?.id ?? "none"}`}
              topics={topicRecords.map((topic) => ({
                id: topic.id,
                lifecycleStatus: topicLifecycleById.get(topic.id)?.status,
                reviewStatus: topic.reviewStatus,
                title: topic.title,
              }))}
            />
          </aside>
          <main className="min-w-0">{renderPanel(activePanel)}</main>
        </div>
      </div>
    </>
  );

  function renderPanel(selectedPanel: string) {
    if (selectedPanel === "metadata") {
      return (
        <DocumentMetadataPanel
          deleteError={deleteErrorMessage}
          metadataError={metadataErrorMessage}
          document={currentDocument}
        />
      );
    }

    if (selectedPanel === "extraction") {
      return <DocumentExtractionPanel document={currentDocument} />;
    }

    if (selectedPanel === "logs") {
      return <DocumentLogsPanel document={currentDocument} />;
    }

    if (selectedPanel === "topics") {
      return (
        <TopicWorkflowPanel
          allowedRelations={allowedRelations}
          document={currentDocument}
          enrichmentError={enrichmentErrorMessage}
          lifecycleError={lifecycleErrorMessage}
          lifecycleStatus={selectedTopicLifecycle}
          lifecycleUpdated={lifecycleUpdatedMessage}
          okfExportError={okfExportErrorMessage}
          relationError={relationErrorMessage}
          relationTargets={relationTargets}
          topic={selectedTopic}
          topicsGeneratedCount={parseTopicsGeneratedCount(topicsGenerated)}
        />
      );
    }

    return (
      <DocumentSummaryPanel
        document={currentDocument}
        topicCount={topicRecords.length}
      />
    );
  }
}

async function resolveTopicLifecycles({
  document,
  topics,
}: {
  document: Document;
  topics: TopicRecord[];
}) {
  const lifecycleByTopicId = new Map<string, OkfConceptLifecycleRecord>();

  if (!document.workspaceId) {
    return lifecycleByTopicId;
  }

  const filenameByTopicId = new Map<string, string>();
  for (const topic of topics) {
    if (topic.reviewStatus !== "approved" || !topic.exportedFilePath) {
      continue;
    }

    filenameByTopicId.set(topic.id, topic.exportedFilePath);
  }

  if (filenameByTopicId.size === 0) {
    return lifecycleByTopicId;
  }

  const lifecycleByFile = await getOkfConceptLifecycleByFile({
    filePaths: Array.from(filenameByTopicId.values()),
    workspaceId: document.workspaceId,
  });

  for (const [topicId, filePath] of filenameByTopicId) {
    lifecycleByTopicId.set(
      topicId,
      lifecycleByFile.get(filePath) ?? { status: "active" },
    );
  }

  return lifecycleByTopicId;
}

async function getRelationTargets(knowledgeRoot: string) {
  try {
    return (await listOkfBundleFiles(knowledgeRoot)).filter(
      (file) =>
        file.filename !== "index.md" &&
        file.filename !== "log.md" &&
        file.filename !== "source_manifest.md",
    );
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return [];
    }

    throw error;
  }
}

function formatExtractionActivity(extraction: Document["extraction"]) {
  if (extraction.status === "completed") {
    return extraction.completedAt
      ? `Extraction finished ${extraction.completedAt} · ${extraction.pageRecords.length} pages`
      : "Extraction finished";
  }

  if (extraction.status === "failed") {
    return extraction.completedAt
      ? `Extraction failed ${extraction.completedAt}`
      : "Extraction failed";
  }

  if (extraction.status === "running" || extraction.status === "queued") {
    return extraction.startedAt
      ? `Extraction started ${extraction.startedAt} · this page auto-refreshes`
      : "Extraction queued · this page auto-refreshes";
  }

  return "Extraction has not been run yet";
}

function resolvePanel(
  panel: string | undefined,
  topicCount: number,
  extractionStatus: Document["extraction"]["status"],
) {
  if (panel && documentPanels.includes(panel)) {
    return panel;
  }

  // Once extraction finishes, the next required action is generating topics,
  // so land there even with zero topics instead of the unchanging summary tab.
  if (topicCount > 0 || extractionStatus === "completed") {
    return "topics";
  }

  return "summary";
}

function parseTopicsGeneratedCount(raw: string | undefined) {
  if (!raw) {
    return null;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function formatRelationError(raw: string | undefined) {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as { code?: string; index?: number };
    return `Relation ${parsed.index ?? 0}: ${
      parsed.code ?? "validation_failed"
    }`;
  } catch {
    return "Relation validation failed.";
  }
}

function formatEnrichmentError(raw: string | undefined) {
  if (!raw) {
    return null;
  }

  if (raw === "llm_enrichment_requires_api_key") {
    return "Add an AI enrichment API key in Settings before enriching topics.";
  }

  return "Topic enrichment could not start.";
}

function formatMetadataError(raw: string | undefined) {
  if (!raw) {
    return null;
  }

  if (raw === "classification_code_too_long") {
    return "Classification code is too long (64 characters max).";
  }

  if (raw === "document_workspace_mismatch") {
    return "This document belongs to a different workspace.";
  }

  return "Document metadata could not be saved.";
}

function formatDeleteError(raw: string | undefined) {
  if (!raw) {
    return null;
  }

  if (raw === "document_delete_reason_required") {
    return "Enter a reason before deleting this document.";
  }

  if (raw === "lifecycle_requires_production_backend") {
    return "Lifecycle actions are only available on the production database backend.";
  }

  return "Document deletion could not be completed.";
}

function formatLifecycleError(raw: string | undefined) {
  if (!raw) {
    return null;
  }

  if (raw === "okf_lifecycle_reason_required") {
    return "Enter a reason before changing this OKF concept lifecycle.";
  }

  if (raw.startsWith("okf_export_missing_document_metadata")) {
    return "Complete the document OKF metadata before changing this exported concept lifecycle.";
  }

  if (raw === "lifecycle_requires_production_backend") {
    return "Lifecycle actions are only available on the production database backend.";
  }

  return "OKF lifecycle change could not be completed.";
}

function formatLifecycleUpdated(raw: string | undefined) {
  if (raw === "archived") {
    return "OKF concept archived. Trusted chat retrieval will no longer use it by default.";
  }

  if (raw === "retracted") {
    return "OKF concept retracted. Trusted chat retrieval will no longer use it.";
  }

  return null;
}

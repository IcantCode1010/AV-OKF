import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { DocumentExtractionPoller } from "@/components/document-extraction-poller";
import { DocumentHeaderDeleteRow } from "@/components/document-header-delete-row";
import {
  DocumentExtractionPanel,
  DocumentLogsPanel,
  DocumentMetadataPanel,
  DocumentSummaryPanel,
  TopicWorkflowPanel,
} from "@/components/document-detail/document-detail-panels";
import { DocumentTreeNav } from "@/components/document-tree-nav";
import { KnowledgeAuthoringPanel } from "@/components/document-detail/knowledge-authoring-panel";
import {
  DocumentProcessingPanel,
  DocumentProcessingStatusStrip,
} from "@/components/document-detail/document-processing-panel";
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
import { listOkfBundleFiles } from "@/lib/okf-bundle";
import { formatOkfExportError } from "@/lib/okf-export-errors";
import { runExtractionAction } from "../actions";
import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import {
  getKnowledgeBundleByIdentity,
  resolveKnowledgeBundleRoot,
} from "@/lib/knowledge-bundles";
import { getLatestKnowledgeAuthoringRun } from "@/lib/knowledge-authoring";
import {
  buildDocumentProcessingFingerprint,
  buildDocumentProcessingState,
  resolveDocumentPanel,
} from "@/lib/document-processing-state";

export const dynamic = "force-dynamic";

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
  const context = await requireAuthWorkspaceContext();
  const [document, topicRecords] = await Promise.all([
    getDocumentById(id),
    getTopicRecordsByDocumentId(id),
  ]);

  if (!document) {
    notFound();
  }

  const currentDocument = document;
  const bundle = await getKnowledgeBundleByIdentity({
    bundleId: currentDocument.knowledgeBundleId,
    workspaceId: context.workspaceId,
  });
  if (!bundle) notFound();
  const currentBundle = bundle;
  const knowledgeRoot = resolveKnowledgeBundleRoot({
    bundleId: currentBundle.id,
    workspaceId: context.workspaceId,
  });
  const [relationTargets, authoringRun] = await Promise.all([
    getRelationTargets(knowledgeRoot),
    getLatestKnowledgeAuthoringRun({ context, documentId: id }),
  ]);
  const allowedRelations = currentBundle.profile.relations;
  const processingState = buildDocumentProcessingState({
    authoringRun,
    bundleName: currentBundle.name,
    document: currentDocument,
    topicCount: topicRecords.length,
  });
  const activePanel = resolveDocumentPanel({
    extractionStatus: currentDocument.extraction.status,
    processingState,
    requestedPanel: panel,
    topicCount: topicRecords.length,
  });
  const processingFingerprint = buildDocumentProcessingFingerprint({
    authoringRun,
    document: currentDocument,
  });
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
  const isAdmin = context.role === "admin";
  const metadataErrorMessage = formatMetadataError(metadataError);
  const lifecycleErrorMessage = formatLifecycleError(lifecycleError);
  const lifecycleUpdatedMessage = formatLifecycleUpdated(lifecycleUpdated);
  const okfExportErrorMessage = formatOkfExportError(okfExportError);

  return (
    <>
      <DocumentExtractionPoller
        authoringStatus={authoringRun?.status}
        automaticApprovalStatus={authoringRun?.automaticApprovalRun?.status}
        documentId={currentDocument.id}
        fingerprint={processingFingerprint}
        processingActive={processingState.active}
        status={currentDocument.extraction.status}
        topicDiscoveryStatus={currentDocument.topicDiscovery?.status}
      />
      <div className="space-y-4">
        <Button asChild variant="ghost" className="w-fit px-0">
          <Link href="/documents">
            <ArrowLeft className="h-4 w-4" />
            Back to documents
          </Link>
        </Button>

        <header className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{currentDocument.fileType}</Badge>
                <StatusBadge status={currentDocument.status} />
                <Badge variant="outline" className="capitalize">
                  extraction {currentDocument.extraction.status}
                </Badge>
                <Badge variant="outline">{topicRecords.length} topics</Badge>
                <Badge variant="outline" className="capitalize">
                  discovery {currentDocument.topicDiscovery?.status ?? "not started"}
                </Badge>
                <Badge variant="outline">{currentBundle.name}</Badge>
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
          <DocumentProcessingStatusStrip
            documentId={currentDocument.id}
            state={processingState}
          />
          <DocumentHeaderDeleteRow
            deleteError={deleteErrorMessage}
            documentId={currentDocument.id}
            isAdmin={isAdmin}
          />
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
    if (selectedPanel === "processing") {
      return (
        <DocumentProcessingPanel
          documentId={currentDocument.id}
          extractionReady={currentDocument.extraction.status === "completed"}
          firstTopicId={topicRecords[0]?.id ?? null}
          run={authoringRun}
          state={processingState}
        />
      );
    }

    if (selectedPanel === "metadata") {
      return (
        <DocumentMetadataPanel
          metadataError={metadataErrorMessage}
          document={currentDocument}
        />
      );
    }

    if (selectedPanel === "extraction") {
      return <DocumentExtractionPanel document={currentDocument} />;
    }

    if (selectedPanel === "authoring") {
      return <KnowledgeAuthoringPanel documentId={currentDocument.id} extractionReady={currentDocument.extraction.status === "completed"} run={authoringRun} />;
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
          profile={currentBundle.profile}
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
    knowledgeBundleId: document.knowledgeBundleId,
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

function parseTopicsGeneratedCount(raw: string | undefined) {
  if (!raw) {
    return null;
  }

  if (raw === "queued") return "queued" as const;
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

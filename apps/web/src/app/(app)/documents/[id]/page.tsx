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
} from "@/lib/document-backend";
import {
  getDefaultKnowledgeRoot,
  listOkfBundleFiles,
} from "@/lib/okf-bundle";
import { formatOkfExportError } from "@/lib/okf-export-errors";
import { getAllowedRelations } from "@/lib/okf-relations";
import { runExtractionAction } from "../actions";

export const dynamic = "force-dynamic";

const documentPanels = ["summary", "metadata", "extraction", "topics", "logs"];

export default async function DocumentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    enrichmentError?: string;
    okfExportError?: string;
    panel?: string;
    relationError?: string;
    topic?: string;
  }>;
}) {
  const { id } = await params;
  const {
    enrichmentError,
    okfExportError,
    panel,
    relationError,
    topic: topicId,
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
  const activePanel = resolvePanel(panel, topicRecords.length);
  const selectedTopic =
    activePanel === "topics"
      ? topicRecords.find((topic) => topic.id === topicId) ??
        topicRecords[0] ??
        null
      : null;
  const relationErrorMessage = formatRelationError(relationError);
  const enrichmentErrorMessage = formatEnrichmentError(enrichmentError);
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
      return <DocumentMetadataPanel document={currentDocument} />;
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
          okfExportError={okfExportErrorMessage}
          relationError={relationErrorMessage}
          relationTargets={relationTargets}
          topic={selectedTopic}
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

function resolvePanel(panel: string | undefined, topicCount: number) {
  if (panel && documentPanels.includes(panel)) {
    return panel;
  }

  if (topicCount > 0) {
    return "topics";
  }

  return "summary";
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

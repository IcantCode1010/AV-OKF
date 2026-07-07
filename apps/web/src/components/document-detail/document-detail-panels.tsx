import Link from "next/link";

import { FileText, Layers, Tags } from "lucide-react";

import { PendingSubmitButton } from "@/components/pending-submit-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  approveTopicContentAction,
  enrichTopicAction,
  generateTopicsAction,
  softDeleteDocumentAction,
  updateDocumentMetadataAction,
  updateTopicContentAction,
  updateTopicReviewStatusAction,
} from "@/app/(app)/documents/actions";
import {
  exportTopicToOkfAction,
  markOkfConceptLifecycleAction,
  updateTopicRelationsAction,
} from "@/app/(app)/documents/okf-actions";
import {
  customPropertiesToText,
  type Document,
  type TopicRecord,
} from "@/lib/document-backend";
import type { OkfBundleFile } from "@/lib/okf-bundle";
import type { OkfConceptLifecycleRecord } from "@/lib/okf-bundle-retriever";

type TopicPanelProps = {
  allowedRelations: string[];
  document: Document;
  lifecycleError: string | null;
  lifecycleStatus: OkfConceptLifecycleRecord;
  lifecycleUpdated: string | null;
  enrichmentError: string | null;
  okfExportError: string | null;
  relationError: string | null;
  relationTargets: OkfBundleFile[];
  topic: TopicRecord | null;
  topicsGeneratedCount: number | null;
};

export function DocumentSummaryPanel({
  document,
  topicCount,
}: {
  document: Document;
  topicCount: number;
}) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Document summary</CardTitle>
          <CardDescription>
            Current processing state and review readiness for this file.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          {[
            ["Extraction", extractionSummary(document.extraction)],
            ["Topic records", `${topicCount} review candidates`],
            ["Knowledge links", "Created after human approval"],
          ].map(([title, detail]) => (
            <div key={title} className="rounded-md border border-border p-4">
              <p className="text-sm font-medium">{title}</p>
              <p className="mt-2 text-sm text-muted-foreground">{detail}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Topic trace</CardTitle>
          <CardDescription>
            Stage 2 extracts page records. Stage 3 creates reviewable topics
            from those records, and approved topics can be exported to OKF.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="flex gap-3 rounded-md border border-border p-4">
            <FileText className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="font-medium">Page extraction</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Page text is available in the extraction panel. Table and image
                metadata fields are reserved in each page record.
              </p>
            </div>
          </div>
          <div className="flex gap-3 rounded-md border border-border p-4">
            <Layers className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="font-medium">Topic coverage</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Topic review, enrichment, relations, and OKF export happen one
                selected topic at a time.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function DocumentMetadataPanel({
  deleteError,
  document,
}: {
  deleteError: string | null;
  document: Document;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Current metadata</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <MetadataRow label="Owner" value={document.owner} />
          <MetadataRow label="Source type" value={document.sourceType} />
          <MetadataRow label="Size" value={document.size} />
          <MetadataRow
            label="Pages"
            value={document.pages > 0 ? `${document.pages}` : "Pending"}
          />
          <MetadataRow label="Updated" value={document.updatedAt} />
          <MetadataRow
            label="Stored file"
            value={document.storageKey ? "Local PDF" : "Seed only"}
          />
          <Separator />
          <div className="space-y-2">
            <p className="text-muted-foreground">OKF source metadata</p>
            <MetadataRow
              label="Aircraft family"
              value={document.aircraftFamily ?? "Missing"}
            />
            <MetadataRow
              label="Manual type"
              value={document.manualType ?? "Missing"}
            />
            <MetadataRow label="ATA" value={document.ata ?? "Missing"} />
            <MetadataRow
              label="Effectivity"
              value={document.effectivity ?? "Missing"}
            />
            <MetadataRow
              label="Source authority"
              value={document.sourceAuthority ?? "Missing"}
            />
            <MetadataRow label="Revision" value={document.revision ?? "Missing"} />
          </div>
          <Separator />
          <div>
            <div className="mb-2 flex items-center gap-2 text-muted-foreground">
              <Tags className="h-4 w-4" />
              Tags
            </div>
            <div className="flex flex-wrap gap-2">
              {document.tags.map((tag) => (
                <Badge key={tag} variant="outline">
                  {tag}
                </Badge>
              ))}
            </div>
          </div>
          {document.customProperties.length > 0 ? (
            <>
              <Separator />
              <div className="space-y-2">
                <p className="text-muted-foreground">Custom properties</p>
                {document.customProperties.map((property) => (
                  <MetadataRow
                    key={property.key}
                    label={property.key}
                    value={property.value}
                  />
                ))}
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Edit metadata</CardTitle>
            <CardDescription>
              Metadata remains editable while extraction records are stored
              separately.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              action={updateDocumentMetadataAction}
              className="grid gap-4 lg:grid-cols-2"
            >
            <input type="hidden" name="id" value={document.id} />
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input id="title" name="title" defaultValue={document.title} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="owner">Owner</Label>
              <Input id="owner" name="owner" defaultValue={document.owner} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="aircraftFamily">Aircraft family</Label>
              <Input
                id="aircraftFamily"
                name="aircraftFamily"
                defaultValue={document.aircraftFamily ?? ""}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="manualType">Manual type</Label>
              <Input
                id="manualType"
                name="manualType"
                defaultValue={document.manualType ?? ""}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ata">ATA</Label>
              <Input id="ata" name="ata" defaultValue={document.ata ?? ""} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="effectivity">Effectivity</Label>
              <Input
                id="effectivity"
                name="effectivity"
                defaultValue={document.effectivity ?? ""}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sourceAuthority">Source authority</Label>
              <Input
                id="sourceAuthority"
                name="sourceAuthority"
                defaultValue={document.sourceAuthority ?? ""}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="revision">Revision</Label>
              <Input
                id="revision"
                name="revision"
                defaultValue={document.revision ?? ""}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tags">Tags</Label>
              <Input
                id="tags"
                name="tags"
                defaultValue={document.tags.join(", ")}
              />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="sourceType">Source type</Label>
                <select
                  id="sourceType"
                  name="sourceType"
                  className={selectClassName}
                  defaultValue={document.sourceType}
                >
                  <option value="general">General</option>
                  <option value="aviation">Aviation</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="status">Status</Label>
                <select
                  id="status"
                  name="status"
                  className={selectClassName}
                  defaultValue={document.status}
                >
                  <option value="processing">Processing</option>
                  <option value="needs_review">Needs review</option>
                  <option value="ready">Ready</option>
                  <option value="indexed">Indexed</option>
                  <option value="blocked">Blocked</option>
                </select>
              </div>
            </div>
            <div className="space-y-2 lg:col-span-2">
              <Label htmlFor="description">Description</Label>
              <textarea
                id="description"
                name="description"
                rows={3}
                className={textareaClassName}
                defaultValue={document.description}
              />
            </div>
            <div className="space-y-2 lg:col-span-2">
              <Label htmlFor="customProperties">Custom properties</Label>
              <textarea
                id="customProperties"
                name="customProperties"
                rows={4}
                className={`${textareaClassName} font-mono`}
                defaultValue={customPropertiesToText(document.customProperties)}
                placeholder="Manual family: AMM&#10;ATA chapter: 24"
              />
              <p className="text-xs text-muted-foreground">
                Use one key/value pair per line, separated by a colon.
              </p>
            </div>
            <div className="lg:col-span-2">
              <PendingSubmitButton pendingLabel="Saving...">
                Save metadata
              </PendingSubmitButton>
            </div>
            </form>
          </CardContent>
        </Card>

        <Card className="border-red-400/30">
          <CardHeader>
            <CardTitle>Lifecycle</CardTitle>
            <CardDescription>
              Soft-delete hides the document and deactivates raw RAG chunks.
              Documents with approved OKF concepts are blocked until those
              concepts are archived or retracted.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {deleteError ? (
              <div className="rounded-md border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">
                {deleteError}
              </div>
            ) : null}
            <form action={softDeleteDocumentAction} className="space-y-3">
              <input type="hidden" name="id" value={document.id} />
              <div className="space-y-2">
                <Label htmlFor="delete-reason">Delete reason</Label>
                <textarea
                  id="delete-reason"
                  name="reason"
                  rows={3}
                  className={textareaClassName}
                  placeholder="Why this source document should be removed from active use"
                  required
                />
              </div>
              <PendingSubmitButton pendingLabel="Deleting...">
                Soft-delete document
              </PendingSubmitButton>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function DocumentExtractionPanel({ document }: { document: Document }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>Extraction</CardTitle>
            <CardDescription>
              Local in-process background extraction. This page polls while
              extraction is queued or running.
            </CardDescription>
          </div>
          <Badge variant="outline" className="capitalize">
            {document.extraction.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {document.extraction.error ? (
          <div className="rounded-md border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-200">
            <p className="font-medium">{document.extraction.error.code}</p>
            <p className="mt-1">{document.extraction.error.message}</p>
          </div>
        ) : null}

        <div className="grid gap-3 md:grid-cols-3">
          <ExtractionMetric
            label="Pages"
            value={`${document.extraction.pageRecords.length}`}
          />
          <ExtractionMetric
            label="Started"
            value={document.extraction.startedAt ?? "Pending"}
          />
          <ExtractionMetric
            label="Completed"
            value={document.extraction.completedAt ?? "Pending"}
          />
        </div>

        <div className="rounded-md border border-border">
          <div className="border-b border-border px-4 py-3">
            <p className="text-sm font-medium">Page records</p>
          </div>
          <div className="max-h-[36rem] space-y-3 overflow-auto p-4">
            {document.extraction.pageRecords.length > 0 ? (
              document.extraction.pageRecords.slice(0, 12).map((page) => (
                <div
                  key={page.pageNumber}
                  className="rounded-md border border-border p-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium">Page {page.pageNumber}</p>
                    <span className="font-mono text-xs text-muted-foreground">
                      {page.charCount} chars
                    </span>
                  </div>
                  <p className="mt-2 line-clamp-4 text-sm text-muted-foreground">
                    {page.text || "No selectable text extracted from this page."}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                No page records yet.
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function DocumentLogsPanel({ document }: { document: Document }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Logs</CardTitle>
        <CardDescription>
          Recent extraction logs for this document.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border border-border">
          <div className="border-b border-border px-4 py-3">
            <p className="text-sm font-medium">Extraction logs</p>
          </div>
          <div className="max-h-[36rem] space-y-3 overflow-auto p-4">
            {document.extraction.logs.length > 0 ? (
              document.extraction.logs.slice(-20).map((log) => (
                <div key={log.id} className="text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <Badge variant="secondary" className="capitalize">
                      {log.level}
                    </Badge>
                    <span className="font-mono text-xs text-muted-foreground">
                      {log.timestamp}
                    </span>
                  </div>
                  <p className="mt-2 text-muted-foreground">{log.message}</p>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                No extraction logs yet.
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function TopicWorkflowPanel({
  allowedRelations,
  document,
  enrichmentError,
  okfExportError,
  relationError,
  relationTargets,
  lifecycleError,
  lifecycleStatus,
  lifecycleUpdated,
  topic,
  topicsGeneratedCount,
}: TopicPanelProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle>{topic ? "Topic review" : "Topic records"}</CardTitle>
            <CardDescription>
              Review one topic at a time. Edits, enrichment, relations, and OKF
              export stay scoped to the selected topic.
            </CardDescription>
          </div>
          <form action={generateTopicsAction}>
            <input type="hidden" name="id" value={document.id} />
            <PendingSubmitButton pendingLabel="Generating...">
              Generate topics
            </PendingSubmitButton>
          </form>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {topicsGeneratedCount !== null ? (
          <div className="rounded-md border border-emerald-400/30 bg-emerald-400/10 p-4 text-sm text-emerald-200">
            Topic generation complete: {topicsGeneratedCount} topic record
            {topicsGeneratedCount === 1 ? "" : "s"} ready for review.
          </div>
        ) : null}
        {okfExportError ? (
          <div className="rounded-md border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-200">
            {okfExportError}
          </div>
        ) : null}
        {document.extraction.status !== "completed" ? (
          <div className="rounded-md border border-border p-4 text-sm text-muted-foreground">
            Complete extraction before generating topic records.
          </div>
        ) : null}
        {topic ? (
          <SelectedTopicPanel
            allowedRelations={allowedRelations}
            documentId={document.id}
            enrichmentError={enrichmentError}
            lifecycleError={lifecycleError}
            lifecycleStatus={lifecycleStatus}
            lifecycleUpdated={lifecycleUpdated}
            relationError={relationError}
            relationTargets={relationTargets}
            topic={topic}
          />
        ) : (
          <div className="rounded-md border border-border p-4 text-sm text-muted-foreground">
            {document.extraction.status === "completed"
              ? "No topics yet. Click “Generate topics” above to create draft topics from the extracted pages."
              : "No topic record is selected."}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SelectedTopicPanel({
  allowedRelations,
  documentId,
  enrichmentError,
  lifecycleError,
  lifecycleStatus,
  lifecycleUpdated,
  relationError,
  relationTargets,
  topic,
}: {
  allowedRelations: string[];
  documentId: string;
  enrichmentError: string | null;
  lifecycleError: string | null;
  lifecycleStatus: OkfConceptLifecycleRecord;
  lifecycleUpdated: string | null;
  relationError: string | null;
  relationTargets: OkfBundleFile[];
  topic: TopicRecord;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{topic.topicType}</Badge>
              <Badge variant="outline" className="capitalize">
                {topic.reviewStatus.replace("_", " ")}
              </Badge>
              <Badge variant="outline" className="capitalize">
                {topic.confidence} confidence
              </Badge>
              {topic.editedAt ? <Badge variant="secondary">edited</Badge> : null}
              {topic.enrichmentStatus !== "none" ? (
                <Badge variant="secondary" className="capitalize">
                  enrichment {topic.enrichmentStatus}
                </Badge>
              ) : null}
              {topic.approvedContentSource ? (
                <Badge variant="outline">
                  approved from {topic.approvedContentSource}
                </Badge>
              ) : null}
            </div>
            <h3 className="mt-3 text-base font-medium">{topic.title}</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {topic.summary}
            </p>
            {topic.editedAt ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Edited by {topic.editedBy ?? "unknown"} on {topic.editedAt}
              </p>
            ) : null}
            <p className="mt-3 font-mono text-xs text-muted-foreground">
              Pages {topic.pageStart}-{topic.pageEnd} | sourcePageNumbers:{" "}
              {topic.sourcePageNumbers.join(", ")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <form action={updateTopicReviewStatusAction} className="flex gap-2">
              <input type="hidden" name="documentId" value={documentId} />
              <input type="hidden" name="topicId" value={topic.id} />
              <select
                name="reviewStatus"
                className={selectClassName}
                defaultValue={topic.reviewStatus}
              >
                <option value="needs_review">Needs review</option>
                <option value="needs_cleanup">Needs cleanup</option>
                {!hasEnrichedContent(topic) ? (
                  <option value="approved">Approved</option>
                ) : null}
                <option value="rejected">Rejected</option>
              </select>
              <PendingSubmitButton pendingLabel="Saving...">
                Save
              </PendingSubmitButton>
            </form>
            {topic.reviewStatus === "approved" ? (
              <form action={exportTopicToOkfAction}>
                <input type="hidden" name="documentId" value={documentId} />
                <input type="hidden" name="topicId" value={topic.id} />
                <PendingSubmitButton pendingLabel="Exporting...">
                  Export OKF
                </PendingSubmitButton>
              </form>
            ) : null}
          </div>
        </div>
      </div>

      {topic.reviewStatus !== "approved" ? (
        <>
          <details className="rounded-md border border-border p-3">
            <summary className="cursor-pointer text-sm font-medium">
              Edit topic content
            </summary>
            <form action={updateTopicContentAction} className="mt-3 space-y-3">
              <input type="hidden" name="documentId" value={documentId} />
              <input type="hidden" name="topicId" value={topic.id} />
              <div className="space-y-2">
                <Label htmlFor={`topic-title-${topic.id}`}>Title</Label>
                <Input
                  id={`topic-title-${topic.id}`}
                  name="title"
                  defaultValue={topic.title}
                  required
                />
                {topic.originalTitle !== topic.title ? (
                  <p className="text-xs text-muted-foreground">
                    Original: {topic.originalTitle}
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor={`topic-summary-${topic.id}`}>Summary</Label>
                <textarea
                  id={`topic-summary-${topic.id}`}
                  name="summary"
                  rows={3}
                  className={textareaClassName}
                  defaultValue={topic.summary}
                />
                {topic.originalSummary !== topic.summary ? (
                  <p className="text-xs text-muted-foreground">
                    Original summary is preserved for audit.
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <PendingSubmitButton pendingLabel="Saving...">
                  Save topic
                </PendingSubmitButton>
                <Button asChild variant="outline">
                  <Link href={`/documents/${documentId}?panel=topics&topic=${topic.id}`}>
                    Cancel
                  </Link>
                </Button>
              </div>
            </form>
          </details>

          <div className="space-y-3 rounded-md border border-border p-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="text-sm font-medium">LLM enrichment</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Uses the current topic title, summary, and extracted source
                  pages to polish content before approval.
                </p>
              </div>
              <form action={enrichTopicAction}>
                <input type="hidden" name="documentId" value={documentId} />
                <input type="hidden" name="topicId" value={topic.id} />
                {topic.enrichmentStatus === "pending" ? (
                  <Button disabled type="submit">
                    Enrichment pending
                  </Button>
                ) : (
                  <PendingSubmitButton pendingLabel="Enriching...">
                    {hasEnrichedContent(topic)
                      ? "Re-enrich topic"
                      : "Enrich this topic"}
                  </PendingSubmitButton>
                )}
              </form>
            </div>
            {enrichmentError ? (
              <div className="rounded-md border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">
                {enrichmentError}
              </div>
            ) : null}
            {topic.enrichmentStatus === "failed" ? (
              <div className="rounded-md border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">
                {topic.enrichmentErrorMessage ?? "Enrichment failed."}
              </div>
            ) : null}
            {topic.enrichmentStatus !== "none" ? (
              <div className="grid gap-3 lg:grid-cols-2">
                <div className="rounded-md border border-border p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">Raw current topic</p>
                    <Badge variant="outline">review draft</Badge>
                  </div>
                  <p className="text-sm font-medium">{topic.title}</p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {topic.summary}
                  </p>
                </div>
                <div className="rounded-md border border-border p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">Enriched topic</p>
                    <Badge variant="outline">
                      {topic.enrichmentModel ?? "model pending"}
                    </Badge>
                  </div>
                  {topic.enrichedAt ? (
                    <p className="mb-2 text-xs text-muted-foreground">
                      Generated {topic.enrichedAt}
                    </p>
                  ) : null}
                  <p className="text-sm font-medium">
                    {topic.enrichedTitle ?? "No enriched title yet."}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {topic.enrichedSummary ?? "No enriched summary yet."}
                  </p>
                </div>
              </div>
            ) : null}
            {hasEnrichedContent(topic) ? (
              <form
                action={approveTopicContentAction}
                className="space-y-3 rounded-md border border-border p-3"
              >
                <input type="hidden" name="documentId" value={documentId} />
                <input type="hidden" name="topicId" value={topic.id} />
                <p className="text-sm font-medium">Approve topic content</p>
                <div className="grid gap-2 text-sm text-muted-foreground">
                  <label className="flex items-center gap-2">
                    <input
                      name="approvedContentSource"
                      required
                      type="radio"
                      value="raw"
                    />
                    Approve the raw/current version
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      name="approvedContentSource"
                      required
                      type="radio"
                      value="enriched"
                    />
                    Approve the enriched version
                  </label>
                </div>
                <PendingSubmitButton pendingLabel="Approving...">
                  Approve selected content
                </PendingSubmitButton>
              </form>
            ) : null}
          </div>
        </>
      ) : null}

      {topic.reviewStatus === "approved" ? (
        <div className="space-y-4">
        <div className="space-y-3 rounded-md border border-border p-3">
          <div>
            <p className="text-sm font-medium">Typed relations</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Relations point this approved topic to other exported OKF files.
            </p>
          </div>
          {relationError ? (
            <div className="rounded-md border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">
              {relationError}
            </div>
          ) : null}
          {topic.relations.length > 0 ? (
            <div className="space-y-2">
              {topic.relations.map((relation, index) => (
                <div
                  className="grid gap-3 rounded-md border border-border p-3 md:grid-cols-[1fr_auto]"
                  key={`${relation.relation}-${relation.target}-${index}`}
                >
                  <div className="space-y-1 text-sm">
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="secondary">{relation.relation}</Badge>
                      <Badge variant="outline">{relation.targetType}</Badge>
                    </div>
                    <p className="font-mono text-xs text-muted-foreground">
                      {relation.target}
                    </p>
                    <p className="text-muted-foreground">{relation.reason}</p>
                  </div>
                  <form action={updateTopicRelationsAction}>
                    <input type="hidden" name="documentId" value={documentId} />
                    <input type="hidden" name="topicId" value={topic.id} />
                    <input type="hidden" name="relationAction" value="remove" />
                    <input type="hidden" name="relationIndex" value={index} />
                    <PendingSubmitButton pendingLabel="Removing...">
                      Remove
                    </PendingSubmitButton>
                  </form>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-md border border-border p-3 text-sm text-muted-foreground">
              No typed relations yet.
            </div>
          )}
          <form
            action={updateTopicRelationsAction}
            className="grid gap-3 rounded-md border border-border p-3 lg:grid-cols-[180px_1fr_1.2fr_auto]"
          >
            <input type="hidden" name="documentId" value={documentId} />
            <input type="hidden" name="topicId" value={topic.id} />
            <input type="hidden" name="relationAction" value="add" />
            <select
              aria-label="Relation"
              className={selectClassName}
              name="relation"
            >
              {allowedRelations.map((relation) => (
                <option key={relation} value={relation}>
                  {relation}
                </option>
              ))}
            </select>
            <select
              aria-label="Relation target"
              className={selectClassName}
              name="target"
            >
              {relationTargets.map((target) => (
                <option
                  key={target.filename}
                  value={`${target.filename}::${target.type}`}
                >
                  {target.title} ({target.filename})
                </option>
              ))}
            </select>
            <Input
              aria-label="Relation reason"
              name="reason"
              placeholder="Reason this relation exists"
            />
            {relationTargets.length > 0 ? (
              <PendingSubmitButton pendingLabel="Adding...">
                Add
              </PendingSubmitButton>
            ) : (
              <Button disabled type="submit">
                Add
              </Button>
            )}
          </form>
        </div>
        <div className="space-y-3 rounded-md border border-red-400/30 p-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium">OKF lifecycle</p>
              <Badge
                variant={
                  lifecycleStatus.status === "active" ? "outline" : "secondary"
                }
                className="capitalize"
              >
                {lifecycleStatus.status}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Archive historical concepts or retract invalid concepts. Trusted
              chat retrieval excludes both states.
            </p>
            {lifecycleStatus.reason ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Current reason: {lifecycleStatus.reason}
              </p>
            ) : null}
          </div>
          {lifecycleUpdated ? (
            <div className="rounded-md border border-emerald-400/30 bg-emerald-400/10 p-3 text-sm text-emerald-200">
              {lifecycleUpdated}
            </div>
          ) : null}
          {lifecycleError ? (
            <div className="rounded-md border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">
              {lifecycleError}
            </div>
          ) : null}
          <form
            action={markOkfConceptLifecycleAction}
            className="grid gap-3 lg:grid-cols-[160px_1fr_auto]"
          >
            <input type="hidden" name="documentId" value={documentId} />
            <input type="hidden" name="topicId" value={topic.id} />
            <select
              aria-label="Lifecycle status"
              className={selectClassName}
              name="lifecycleStatus"
            >
              <option value="archived">Archive</option>
              <option value="retracted">Retract</option>
            </select>
            <Input
              aria-label="Lifecycle reason"
              name="reason"
              placeholder="Reason required for lifecycle audit log"
              required
            />
            <PendingSubmitButton pendingLabel="Saving...">
              Apply
            </PendingSubmitButton>
          </form>
        </div>
        </div>
      ) : null}
    </div>
  );
}

function extractionSummary(extraction: Document["extraction"]) {
  if (extraction.status === "completed") {
    return extraction.completedAt
      ? `${extraction.pageRecords.length} pages · finished ${extraction.completedAt}`
      : `${extraction.pageRecords.length} pages extracted`;
  }

  if (extraction.status === "failed") {
    return "Extraction failed; check logs";
  }

  if (extraction.status === "running") {
    return extraction.startedAt
      ? `Running since ${extraction.startedAt}`
      : "Extraction running in background";
  }

  return extraction.startedAt
    ? `Queued at ${extraction.startedAt}`
    : "Extraction queued";
}

function ExtractionMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border p-4">
      <p className="text-xs uppercase text-muted-foreground">{label}</p>
      <p className="mt-2 text-sm font-medium">{value}</p>
    </div>
  );
}

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium capitalize">{value}</span>
    </div>
  );
}

function hasEnrichedContent(topic: TopicRecord) {
  return Boolean(topic.enrichedTitle && topic.enrichedSummary);
}

const selectClassName =
  "h-9 rounded-md border border-input bg-transparent px-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring";

const textareaClassName =
  "w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring";

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileText, Layers, Tags } from "lucide-react";

import { DocumentExtractionPoller } from "@/components/document-extraction-poller";
import { StatusBadge } from "@/components/status-badge";
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
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { Separator } from "@/components/ui/separator";
import {
  customPropertiesToText,
  getDocumentById,
  getTopicRecordsByDocumentId,
  type TopicRecord,
} from "@/lib/document-backend";
import {
  getDefaultKnowledgeRoot,
  listOkfBundleFiles,
  type OkfBundleFile,
} from "@/lib/okf-bundle";
import { getAllowedRelations } from "@/lib/okf-relations";
import {
  generateTopicsAction,
  runExtractionAction,
  updateDocumentMetadataAction,
  updateTopicReviewStatusAction,
} from "../actions";
import {
  exportTopicToOkfAction,
  updateTopicRelationsAction,
} from "../okf-actions";

export const dynamic = "force-dynamic";

export default async function DocumentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ relationError?: string }>;
}) {
  const { id } = await params;
  const { relationError } = await searchParams;
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

  const relationErrorMessage = formatRelationError(relationError);

  return (
    <>
      <DocumentExtractionPoller status={document.extraction.status} />
      <div className="flex flex-col gap-4">
        <Button asChild variant="ghost" className="w-fit px-0">
          <Link href="/documents">
            <ArrowLeft className="h-4 w-4" />
            Back to documents
          </Link>
        </Button>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{document.fileType}</Badge>
              <StatusBadge status={document.status} />
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">
              {document.title}
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              {document.description}
            </p>
          </div>
          {document.storageKey ? (
            <form action={runExtractionAction}>
              <input type="hidden" name="id" value={document.id} />
              <PendingSubmitButton pendingLabel="Starting...">
                Run extraction
              </PendingSubmitButton>
            </form>
          ) : (
            <Button disabled>Seed document has no stored PDF</Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <Card>
          <CardHeader>
            <CardTitle>Document readiness</CardTitle>
            <CardDescription>
              Extraction now writes page records locally. Topic records and OKF
              coverage arrive in later stages.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            {[
              ["Extraction", extractionSummary(document.extraction.status)],
              ["Topic records", `${topicRecords.length} review candidates`],
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
            <CardTitle>Metadata</CardTitle>
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
              <MetadataRow label="Manual type" value={document.manualType ?? "Missing"} />
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
      </div>

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

          <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-md border border-border">
              <div className="border-b border-border px-4 py-3">
                <p className="text-sm font-medium">Page records</p>
              </div>
              <div className="max-h-96 space-y-3 overflow-auto p-4">
                {document.extraction.pageRecords.length > 0 ? (
                  document.extraction.pageRecords.slice(0, 8).map((page) => (
                    <div key={page.pageNumber} className="rounded-md border border-border p-3">
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

            <div className="rounded-md border border-border">
              <div className="border-b border-border px-4 py-3">
                <p className="text-sm font-medium">Extraction logs</p>
              </div>
              <div className="max-h-96 space-y-3 overflow-auto p-4">
                {document.extraction.logs.length > 0 ? (
                  document.extraction.logs.slice(-10).map((log) => (
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
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle>Topic records</CardTitle>
              <CardDescription>
                Manual Stage 3 generation from extracted page records. Reruns
                replace draft topics and preserve approved or rejected topics.
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
          {document.extraction.status !== "completed" ? (
            <div className="rounded-md border border-border p-4 text-sm text-muted-foreground">
              Complete extraction before generating topic records.
            </div>
          ) : null}
          {topicRecords.length > 0 ? (
            <div className="space-y-3">
              {topicRecords.map((topic) => (
                <TopicRecordCard
                  allowedRelations={allowedRelations}
                  key={topic.id}
                  documentId={document.id}
                  relationError={relationErrorMessage}
                  relationTargets={relationTargets}
                  topic={topic}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-md border border-border p-4 text-sm text-muted-foreground">
              No topic records yet.
            </div>
          )}
        </CardContent>
      </Card>

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
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
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
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
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
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                defaultValue={document.description}
              />
            </div>
            <div className="space-y-2 lg:col-span-2">
              <Label htmlFor="customProperties">Custom properties</Label>
              <textarea
                id="customProperties"
                name="customProperties"
                rows={4}
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
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

      <Card>
        <CardHeader>
          <CardTitle>Future topic trace</CardTitle>
          <CardDescription>
            Stage 2 produces page records. Stage 3 will generate reviewable
            topics from document structure.
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
                Reviewable topic records and OKF coverage links will appear
                after later stages.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

function extractionSummary(status: string) {
  if (status === "completed") {
    return "Page records extracted";
  }

  if (status === "failed") {
    return "Extraction failed; check logs";
  }

  if (status === "running") {
    return "Extraction running in background";
  }

  return "Extraction queued";
}

function ExtractionMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border p-4">
      <p className="text-xs uppercase text-muted-foreground">{label}</p>
      <p className="mt-2 text-sm font-medium">{value}</p>
    </div>
  );
}

function TopicRecordCard({
  allowedRelations,
  documentId,
  relationError,
  relationTargets,
  topic,
}: {
  allowedRelations: string[];
  documentId: string;
  relationError: string | null;
  relationTargets: OkfBundleFile[];
  topic: TopicRecord;
}) {
  return (
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
          </div>
          <h3 className="mt-3 text-base font-medium">{topic.title}</h3>
          <p className="mt-2 text-sm text-muted-foreground">{topic.summary}</p>
          <p className="mt-3 font-mono text-xs text-muted-foreground">
            Pages {topic.pageStart}-{topic.pageEnd} | sourcePageNumbers:{" "}
            {topic.sourcePageNumbers.join(", ")}
          </p>
        </div>
        <form action={updateTopicReviewStatusAction} className="flex gap-2">
          <input type="hidden" name="documentId" value={documentId} />
          <input type="hidden" name="topicId" value={topic.id} />
          <select
            name="reviewStatus"
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
            defaultValue={topic.reviewStatus}
          >
            <option value="needs_review">Needs review</option>
            <option value="needs_cleanup">Needs cleanup</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
          <PendingSubmitButton pendingLabel="Saving...">Save</PendingSubmitButton>
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
      {topic.reviewStatus === "approved" ? (
        <div className="mt-4 space-y-3 border-t border-border pt-4">
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
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
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
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
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
      ) : null}
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

function formatRelationError(raw: string | undefined) {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as { code?: string; index?: number };
    return `Relation ${parsed.index ?? 0}: ${parsed.code ?? "validation_failed"}`;
  } catch {
    return "Relation validation failed.";
  }
}

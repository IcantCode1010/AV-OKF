import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileText, Layers, Tags } from "lucide-react";

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
} from "@/lib/document-vault";
import { updateDocumentMetadataAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function DocumentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const document = await getDocumentById(id);

  if (!document) {
    notFound();
  }

  return (
    <>
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
          <Button disabled>Run extraction in Stage 2</Button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <Card>
          <CardHeader>
            <CardTitle>Document readiness</CardTitle>
            <CardDescription>
              Shell-only panels for future extraction, topic records, and OKF
              coverage.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            {[
              ["Extraction", "Waiting for Stage 2 pipeline"],
              ["Topic records", "Generated after structure detection"],
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
          <CardTitle>Edit metadata</CardTitle>
          <CardDescription>
            Stage 1 stores editable metadata locally. Extraction-specific fields
            arrive in Stage 2.
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
          <CardTitle>Future trace</CardTitle>
          <CardDescription>
            Stage 0 reserves the information architecture for later ingestion
            evidence.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="flex gap-3 rounded-md border border-border p-4">
            <FileText className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="font-medium">Page extraction</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Page text, tables, and image metadata will appear here.
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

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium capitalize">{value}</span>
    </div>
  );
}

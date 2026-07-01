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
import { Separator } from "@/components/ui/separator";
import { getDocumentById, getDocuments } from "@/lib/mock-data";

export function generateStaticParams() {
  return getDocuments().map((document) => ({ id: document.id }));
}

export default async function DocumentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const document = getDocumentById(id);

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
            <MetadataRow label="Pages" value={`${document.pages}`} />
            <MetadataRow label="Updated" value={document.updatedAt} />
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
          </CardContent>
        </Card>
      </div>

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

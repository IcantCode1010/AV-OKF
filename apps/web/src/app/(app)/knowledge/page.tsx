import Link from "next/link";
import type { ComponentType } from "react";
import {
  BookOpenCheck,
  Clock,
  FileText,
  FolderOpen,
  ShieldCheck,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getDefaultKnowledgeRoot, getOkfBundleSummary } from "@/lib/okf-bundle";

export const dynamic = "force-dynamic";

export default async function KnowledgePage() {
  const summary = await getOkfBundleSummary(getDefaultKnowledgeRoot());
  const latestModified = summary.latestModifiedAt
    ? formatDate(summary.latestModifiedAt)
    : "No exports yet";

  return (
    <>
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <Badge variant="secondary">Knowledge</Badge>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">
            Knowledge bundles
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Open the local OKF bundle generated from reviewed document topics.
          </p>
        </div>
      </div>

      <Card className="max-w-3xl">
        <CardHeader>
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="flex gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-border bg-secondary">
                <BookOpenCheck className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle>AV-OKF Knowledge Bundle</CardTitle>
                <CardDescription className="mt-1">
                  Approved OKF Markdown files exported from reviewed topic records.
                </CardDescription>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">OKF bundle</Badge>
              <Badge variant="outline">Local volume</Badge>
              <Badge variant="outline">Preview</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <BundleMetric
              icon={FileText}
              label="Files"
              value={summary.fileCount.toString()}
            />
            <BundleMetric
              icon={BookOpenCheck}
              label="System topics"
              value={summary.groupCounts.system_topic.toString()}
            />
            <BundleMetric
              icon={ShieldCheck}
              label="Reserved files"
              value={summary.groupCounts.reserved.toString()}
            />
            <BundleMetric icon={Clock} label="Last updated" value={latestModified} />
          </div>

          {summary.fileCount === 0 ? (
            <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
              No exported OKF files yet. Approve a topic and export it to populate
              this bundle.
            </div>
          ) : null}

          <Button asChild>
            <Link href="/knowledge/bundle">
              <FolderOpen className="h-4 w-4" />
              Open bundle
            </Link>
          </Button>
        </CardContent>
      </Card>
    </>
  );
}

function BundleMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-2 truncate text-sm font-medium">{value}</div>
    </div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

import Link from "next/link";
import {
  ArrowLeft,
  BookOpenCheck,
  FileText,
  Folder,
  FolderOpen,
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
import {
  getDefaultKnowledgeRoot,
  getOkfBundleSummary,
  type OkfBundleFile,
  type OkfBundleFileContent,
  type OkfBundleGroup,
  readOkfBundleFile,
} from "@/lib/okf-bundle";

export const dynamic = "force-dynamic";

const GROUPS: Array<{
  group: OkfBundleGroup;
  icon: typeof Folder;
  label: string;
}> = [
  { group: "reserved", icon: FolderOpen, label: "Reserved" },
  { group: "system_topic", icon: BookOpenCheck, label: "System topics" },
  { group: "fault_route", icon: Folder, label: "Fault routes" },
  { group: "routing_rule", icon: Folder, label: "Routing rules" },
  { group: "other", icon: Folder, label: "Other" },
];

export default async function KnowledgeBundlePage({
  searchParams,
}: {
  searchParams: Promise<{ file?: string }>;
}) {
  const { file } = await searchParams;
  const knowledgeRoot = getDefaultKnowledgeRoot();
  const summary = await getOkfBundleSummary(knowledgeRoot);
  const selectedName = getSelectedFilename(summary.files, summary.defaultFile, file);
  const selectedFile = selectedName
    ? await readOkfBundleFile(knowledgeRoot, selectedName)
    : null;

  return (
    <>
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <Button asChild className="mb-3" size="sm" variant="ghost">
            <Link href="/knowledge">
              <ArrowLeft className="h-4 w-4" />
              Knowledge
            </Link>
          </Button>
          <Badge variant="secondary">OKF bundle</Badge>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">
            AV-OKF Knowledge Bundle
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Browse the exported OKF bundle by file role and preview any Markdown
            file inside it.
          </p>
        </div>
        <Badge variant="outline">{summary.fileCount} files</Badge>
      </div>

      <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Bundle structure</CardTitle>
            <CardDescription>
              Folder groups are derived from reserved filenames and OKF
              frontmatter.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {GROUPS.map((groupConfig) => (
              <BundleGroupSection
                key={groupConfig.group}
                config={groupConfig}
                files={summary.files.filter(
                  (bundleFile) => bundleFile.group === groupConfig.group,
                )}
                selectedName={selectedName}
              />
            ))}
          </CardContent>
        </Card>

        <BundlePreview file={selectedFile} />
      </div>
    </>
  );
}

function BundleGroupSection({
  config,
  files,
  selectedName,
}: {
  config: (typeof GROUPS)[number];
  files: OkfBundleFile[];
  selectedName?: string;
}) {
  const Icon = config.icon;

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{config.label}</span>
        </div>
        <Badge variant="outline">{files.length}</Badge>
      </div>
      <div className="space-y-1">
        {files.length > 0 ? (
          files.map((bundleFile) => (
            <Button
              key={bundleFile.filename}
              asChild
              className="h-auto w-full justify-start px-3 py-2"
              variant={
                bundleFile.filename === selectedName ? "secondary" : "ghost"
              }
            >
              <Link
                href={`/knowledge/bundle?file=${encodeURIComponent(
                  bundleFile.filename,
                )}`}
              >
                <FileText className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-sm">
                    {bundleFile.title}
                  </span>
                  <span className="block truncate font-mono text-xs text-muted-foreground">
                    {bundleFile.filename}
                  </span>
                </span>
              </Link>
            </Button>
          ))
        ) : (
          <div className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
            No files in this group.
          </div>
        )}
      </div>
    </section>
  );
}

function BundlePreview({ file }: { file: OkfBundleFileContent | null }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle>{file?.title ?? "No file selected"}</CardTitle>
            <CardDescription>
              {file?.filename ??
                "Export approved topics to populate the bundle preview."}
            </CardDescription>
          </div>
          {file ? (
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{file.type}</Badge>
              <Badge variant="outline">{file.reviewStatus}</Badge>
            </div>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        {file ? (
          <pre className="max-h-[680px] overflow-auto rounded-md border border-border bg-background p-4 text-xs leading-6 text-muted-foreground">
            {file.content}
          </pre>
        ) : (
          <div className="flex min-h-80 items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <BookOpenCheck className="h-4 w-4" />
              OKF preview will appear here.
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function getSelectedFilename(
  files: OkfBundleFile[],
  defaultFile: string | undefined,
  requestedFile: string | undefined,
) {
  if (requestedFile && files.some((file) => file.filename === requestedFile)) {
    return requestedFile;
  }

  return defaultFile;
}

import Link from "next/link";
import { BookOpenCheck, FileText } from "lucide-react";

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
  listOkfBundleFiles,
  readOkfBundleFile,
} from "@/lib/okf-bundle";

export const dynamic = "force-dynamic";

export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: Promise<{ file?: string }>;
}) {
  const { file } = await searchParams;
  const knowledgeRoot = getDefaultKnowledgeRoot();
  const files = await getFiles(knowledgeRoot);
  const selectedName = file ?? files[0]?.filename;
  const selectedFile = selectedName
    ? await getSelectedFile(knowledgeRoot, selectedName)
    : null;

  return (
    <>
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <Badge variant="secondary">OKF bundle</Badge>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">
            Knowledge
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Preview approved Markdown files exported from reviewed topic records.
          </p>
        </div>
        <Badge variant="outline">{files.length} files</Badge>
      </div>

      <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Bundle files</CardTitle>
            <CardDescription>
              Files are read from the configured OKF knowledge root.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {files.length > 0 ? (
              files.map((bundleFile) => (
                <Button
                  key={bundleFile.filename}
                  asChild
                  className="h-auto w-full justify-start px-3 py-3"
                  variant={
                    bundleFile.filename === selectedName ? "secondary" : "ghost"
                  }
                >
                  <Link href={`/knowledge?file=${encodeURIComponent(bundleFile.filename)}`}>
                    <FileText className="h-4 w-4" />
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
              <div className="rounded-md border border-border p-4 text-sm text-muted-foreground">
                No OKF files have been exported yet.
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <CardTitle>{selectedFile?.title ?? "No file selected"}</CardTitle>
                <CardDescription>
                  {selectedFile?.filename ?? "Export an approved topic to populate the bundle."}
                </CardDescription>
              </div>
              {selectedFile ? (
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">{selectedFile.type}</Badge>
                  <Badge variant="outline">{selectedFile.reviewStatus}</Badge>
                </div>
              ) : null}
            </div>
          </CardHeader>
          <CardContent>
            {selectedFile ? (
              <pre className="max-h-[680px] overflow-auto rounded-md border border-border bg-background p-4 text-xs leading-6 text-muted-foreground">
                {selectedFile.content}
              </pre>
            ) : (
              <div className="flex min-h-80 items-center justify-center rounded-md border border-border text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <BookOpenCheck className="h-4 w-4" />
                  OKF preview will appear here.
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

async function getFiles(knowledgeRoot: string) {
  try {
    return await listOkfBundleFiles(knowledgeRoot);
  } catch (error) {
    if (isMissingDirectoryError(error)) {
      return [];
    }

    throw error;
  }
}

async function getSelectedFile(knowledgeRoot: string, filename: string) {
  try {
    return await readOkfBundleFile(knowledgeRoot, filename);
  } catch (error) {
    if (error instanceof Error && error.message === "okf_preview_only_markdown") {
      return null;
    }

    throw error;
  }
}

function isMissingDirectoryError(error: unknown) {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

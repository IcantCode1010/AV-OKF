import { DatabaseZap, RefreshCw } from "lucide-react";

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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import { isProductionBackend } from "@/lib/production-document-service";
import { RAG_CHUNK_STRATEGIES } from "@/lib/rag-chunker";
import {
  formatChunkingStrategyLabel,
  getDefaultChunkingStrategyId,
  getReindexAdminState,
} from "@/lib/rag-reindex";
import type { ReindexDocumentRow } from "@/lib/rag-types";
import { requestReindexAction, syncApprovedTopicsToRagAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function AdminReindexPage({
  searchParams,
}: {
  searchParams?: Promise<{
    okfFailed?: string;
    okfSynced?: string;
    okfUnchanged?: string;
  }>;
}) {
  const context = await requireAuthWorkspaceContext();
  const params = await searchParams;

  if (!isProductionBackend()) {
    return (
      <section className="space-y-6">
        <div>
          <p className="text-sm text-muted-foreground">Admin</p>
          <h1 className="text-3xl font-semibold tracking-tight">RAG reindex</h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Production backend required</CardTitle>
            <CardDescription>
              Reindexing uses Postgres, BullMQ, and the RAG worker. The local
              JSON vault can display documents, but it does not own vector
              index records.
            </CardDescription>
          </CardHeader>
        </Card>
      </section>
    );
  }

  const state = await getReindexAdminState(context);
  const activeDocument = state.activeDocument;

  return (
    <section className="space-y-6">
      {activeDocument ? <meta httpEquiv="refresh" content="2" /> : null}
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Admin</p>
          <h1 className="text-3xl font-semibold tracking-tight">RAG reindex</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            Rebuild retrieval chunks and embeddings for one document at a time.
            Reindex deletes the document&apos;s old chunks immediately before
            storing the fresh run.
          </p>
        </div>
        {activeDocument ? (
          <Badge variant="secondary" className="w-fit gap-2">
            <RefreshCw className="h-3.5 w-3.5" />
            Processing {activeDocument.title}
          </Badge>
        ) : (
          <Badge variant="outline" className="w-fit">
            Idle
          </Badge>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Legacy OKF-to-RAG cache</CardTitle>
          <CardDescription>
            Optional cache projection for approved topics. Chat now reads the
            exported OKF bundle files directly for authoritative OKF evidence;
            this sync is only a compatibility path for experiments that need
            OKF-shaped chunks inside the RAG index.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">sourceType: okf_topic</Badge>
            <Badge variant="outline">legacy cache</Badge>
            <Badge variant="outline">optional</Badge>
            <Badge variant="outline">idempotent</Badge>
          </div>
          <form action={syncApprovedTopicsToRagAction}>
            <PendingSubmitButton pendingLabel="Syncing...">
              <DatabaseZap className="mr-2 h-4 w-4" />
              Refresh legacy OKF cache
            </PendingSubmitButton>
          </form>
        </CardContent>
        {params?.okfSynced || params?.okfUnchanged || params?.okfFailed ? (
          <CardContent className="border-t pt-4">
            <p className="text-sm text-muted-foreground">
              Last sync: {formatCount(params.okfSynced)} synced,{" "}
              {formatCount(params.okfUnchanged)} unchanged,{" "}
              {formatCount(params.okfFailed)} failed.
            </p>
          </CardContent>
        ) : null}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Document indexes</CardTitle>
          <CardDescription>
            Any authenticated workspace member can access this MVP admin view;
            role-specific admin policy is not implemented yet.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Document</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Strategy</TableHead>
                <TableHead>Chunks</TableHead>
                <TableHead>Last indexed</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {state.documents.map((document) => (
                <ReindexRow
                  activeDocument={activeDocument}
                  document={document}
                  key={document.id}
                />
              ))}
              {state.documents.length === 0 ? (
                <TableRow>
                  <TableCell
                    className="py-8 text-center text-muted-foreground"
                    colSpan={7}
                  >
                    No documents in this workspace.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </section>
  );
}

function ReindexRow({
  activeDocument,
  document,
}: {
  activeDocument: ReindexDocumentRow | null;
  document: ReindexDocumentRow;
}) {
  const disabledByActiveDocument =
    activeDocument !== null && activeDocument.id !== document.id;
  const defaultStrategy =
    document.chunkingStrategyId ?? getDefaultChunkingStrategyId();

  return (
    <TableRow>
      <TableCell>
        <div className="max-w-xs">
          <p className="truncate font-medium">{document.title}</p>
          {document.latestError ? (
            <p className="mt-1 truncate text-xs text-destructive">
              {document.latestError}
            </p>
          ) : null}
        </div>
      </TableCell>
      <TableCell className="text-muted-foreground">
        {document.sizeLabel}
      </TableCell>
      <TableCell>{formatChunkingStrategyLabel(document.chunkingStrategyId)}</TableCell>
      <TableCell>{document.chunkCount}</TableCell>
      <TableCell className="text-muted-foreground">
        {formatDate(document.lastIndexedAt)}
      </TableCell>
      <TableCell>
        <Badge variant={document.ragStatus === "failed" ? "destructive" : "outline"}>
          {document.ragStatus}
        </Badge>
      </TableCell>
      <TableCell className="text-right">
        <form action={requestReindexAction} className="inline-flex items-center gap-2">
          <input name="documentId" type="hidden" value={document.id} />
          <select
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            defaultValue={defaultStrategy}
            disabled={disabledByActiveDocument}
            name="chunkingStrategyId"
          >
            {RAG_CHUNK_STRATEGIES.map((strategy) => (
              <option key={strategy.id} value={strategy.id}>
                {strategy.label}
              </option>
            ))}
          </select>
          {disabledByActiveDocument ? (
            <Button disabled type="button">
              Waiting
            </Button>
          ) : (
            <PendingSubmitButton pendingLabel="Starting...">
              Reindex
            </PendingSubmitButton>
          )}
        </form>
      </TableCell>
    </TableRow>
  );
}

function formatDate(date: Date | null) {
  if (!date) {
    return "Never";
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatCount(value?: string) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

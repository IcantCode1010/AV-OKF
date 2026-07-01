import Link from "next/link";
import {
  ArrowUpRight,
  FileClock,
  Files,
  ShieldCheck,
  UserCheck,
} from "lucide-react";

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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getActivityEvents,
  getCurrentWorkspace,
  getDocumentMetrics,
  getRecentDocuments,
} from "@/lib/document-vault";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const workspace = getCurrentWorkspace();
  const metrics = await getDocumentMetrics();
  const recentDocuments = await getRecentDocuments();
  const activityEvents = await getActivityEvents();

  const summaryCards = [
    {
      label: "Documents",
      value: metrics.total,
      detail: "Local vault records",
      icon: Files,
    },
    {
      label: "Processing",
      value: metrics.processing,
      detail: "Awaiting extraction",
      icon: FileClock,
    },
    {
      label: "Ready",
      value: metrics.ready,
      detail: "Searchable shell state",
      icon: ShieldCheck,
    },
    {
      label: "Review",
      value: metrics.review,
      detail: "Needs human check",
      icon: UserCheck,
    },
  ];

  return (
    <>
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <Badge variant="secondary">Stage 1 document vault</Badge>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">
            {workspace.name}
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            A local document vault for PDFs, metadata, tags, and processing
            status before extraction and retrieval are added.
          </p>
        </div>
        <Button asChild>
          <Link href="/documents">
            Open library
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map((card) => (
          <Card key={card.label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {card.label}
              </CardTitle>
              <card.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold">{card.value}</div>
              <p className="mt-1 text-xs text-muted-foreground">
                {card.detail}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.4fr_0.8fr]">
        <Card>
          <CardHeader>
            <CardTitle>Recent documents</CardTitle>
            <CardDescription>
              Uploaded and seeded documents in the Stage 1 local vault.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead className="text-right">Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentDocuments.map((document) => (
                  <TableRow key={document.id}>
                    <TableCell>
                      <Link
                        href={`/documents/${document.id}`}
                        className="font-medium hover:underline"
                      >
                        {document.title}
                      </Link>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {document.fileType} - {document.size}
                      </p>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={document.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {document.owner}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {document.updatedAt}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Activity</CardTitle>
            <CardDescription>
              Local upload and metadata activity before the extraction pipeline.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {activityEvents.map((event) => (
              <div key={event.id} className="flex gap-3">
                <div className="mt-1 h-2 w-2 rounded-full bg-primary" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{event.label}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {event.documentTitle}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground">
                  {event.timestamp}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

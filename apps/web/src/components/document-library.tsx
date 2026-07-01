"use client";

import Link from "next/link";
import { FileText, Search } from "lucide-react";
import { useMemo, useState } from "react";

import type { Document, DocumentStatus } from "@/lib/document-vault";
import { statusLabels, StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const filters: Array<"all" | DocumentStatus> = [
  "all",
  "ready",
  "processing",
  "needs_review",
  "indexed",
  "blocked",
];

export function DocumentLibrary({ documents }: { documents: Document[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | DocumentStatus>("all");

  const filteredDocuments = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return documents.filter((document) => {
      const matchesStatus = status === "all" || document.status === status;
      const matchesQuery =
        normalizedQuery.length === 0 ||
        document.title.toLowerCase().includes(normalizedQuery) ||
        document.tags.some((tag) => tag.toLowerCase().includes(normalizedQuery));
      return matchesStatus && matchesQuery;
    });
  }, [documents, query, status]);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="pl-9"
              placeholder="Filter by title or tag"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {filters.map((filter) => (
              <Button
                key={filter}
                variant={status === filter ? "secondary" : "outline"}
                size="sm"
                onClick={() => setStatus(filter)}
              >
                {filter === "all" ? "All" : statusLabels[filter]}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {filteredDocuments.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Document</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Tags</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead className="text-right">Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredDocuments.map((document) => (
                  <TableRow key={document.id}>
                    <TableCell>
                      <Link
                        href={`/documents/${document.id}`}
                        className="flex items-center gap-3"
                      >
                        <span className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background">
                          <FileText className="h-4 w-4 text-muted-foreground" />
                        </span>
                        <span>
                          <span className="block font-medium">
                            {document.title}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {document.fileType} - {document.size} -{" "}
                            {document.pages} pages
                          </span>
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={document.status} />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {document.tags.slice(0, 2).map((tag) => (
                          <Badge key={tag} variant="secondary">
                            {tag}
                          </Badge>
                        ))}
                      </div>
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
          ) : (
            <div className="flex min-h-64 flex-col items-center justify-center gap-3 p-8 text-center">
              <FileText className="h-8 w-8 text-muted-foreground" />
              <div>
                <p className="font-medium">No documents match that filter</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Clear the search or switch status filters.
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ChevronDown,
  Database,
  FileText,
  Folder,
  FolderOpen,
  ScrollText,
  Workflow,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

type DocumentTreeTopic = {
  id: string;
  lifecycleStatus?: string;
  title: string;
  reviewStatus: string;
};

type DocumentTreeNavProps = {
  activePanel: string;
  activeTopicId: string | null;
  documentId: string;
  topics: DocumentTreeTopic[];
};

const documentItems = [
  { id: "processing", label: "Processing", hrefPanel: "processing" },
  { id: "summary", label: "Summary", hrefPanel: "summary" },
  { id: "metadata", label: "Metadata", hrefPanel: "metadata" },
  { id: "extraction", label: "Extraction", hrefPanel: "extraction" },
  { id: "authoring", label: "AI authoring", hrefPanel: "authoring" },
];

export function DocumentTreeNav({
  activePanel,
  activeTopicId,
  documentId,
  topics,
}: DocumentTreeNavProps) {
  const activeDocumentBranch = ["processing", "summary", "metadata", "extraction", "authoring"].includes(
    activePanel,
  );
  const activeTopicsBranch = activePanel === "topics";
  const logsSelected = activePanel === "logs";
  const [documentOpen, setDocumentOpen] = useState(activeDocumentBranch);
  const [topicsOpen, setTopicsOpen] = useState(activeTopicsBranch);

  return (
    <>
      <nav aria-label="Document sections" className="md:hidden">
        <div className="grid gap-2 sm:grid-cols-2">
          {documentItems.map((item) => (
            <MobileTreeLink
              href={panelHref(documentId, item.hrefPanel)}
              key={item.id}
              selected={activePanel === item.hrefPanel}
            >
              {item.label}
            </MobileTreeLink>
          ))}
          <MobileTreeLink
            href={firstTopicHref(documentId, topics)}
            selected={activePanel === "topics"}
          >
            Topics ({topics.length})
          </MobileTreeLink>
          <MobileTreeLink
            href={panelHref(documentId, "logs")}
            selected={logsSelected}
          >
            Logs
          </MobileTreeLink>
        </div>
      </nav>

      <nav
        aria-label="Document tree"
        className="hidden rounded-lg border border-border bg-card p-2 md:block"
      >
        <Collapsible open={documentOpen} onOpenChange={setDocumentOpen}>
          <CollapsibleTrigger className={branchButtonClassName}>
            <ChevronDown className="h-4 w-4 transition-transform duration-150 group-data-[state=closed]:-rotate-90 motion-reduce:transition-none" />
            <FileText className="h-4 w-4 text-muted-foreground" />
            <span>Document</span>
          </CollapsibleTrigger>
          <CollapsibleContent className="ml-3 border-l border-border pl-2">
            {documentItems.map((item) => (
              <TreeLeafLink
                href={panelHref(documentId, item.hrefPanel)}
                icon={item.id === "processing" ? <Workflow className="h-4 w-4 text-muted-foreground" /> : undefined}
                key={item.id}
                selected={activePanel === item.hrefPanel}
              >
                {item.label}
              </TreeLeafLink>
            ))}
          </CollapsibleContent>
        </Collapsible>

        <Collapsible open={topicsOpen} onOpenChange={setTopicsOpen}>
          <CollapsibleTrigger className={branchButtonClassName}>
            <ChevronDown className="h-4 w-4 transition-transform duration-150 group-data-[state=closed]:-rotate-90 motion-reduce:transition-none" />
            {topicsOpen ? (
              <FolderOpen className="h-4 w-4 text-muted-foreground" />
            ) : (
              <Folder className="h-4 w-4 text-muted-foreground" />
            )}
            <span>Topics</span>
            <Badge variant="outline" className="ml-auto">
              {topics.length}
            </Badge>
          </CollapsibleTrigger>
          <CollapsibleContent className="ml-3 border-l border-border pl-2">
            {topics.length > 0 ? (
              topics.map((topic) => {
                const displayStatus = getTopicDisplayStatus(topic);

                return (
                  <TreeLeafLink
                    href={topicHref(documentId, topic.id)}
                    key={topic.id}
                    selected={
                      activePanel === "topics" && activeTopicId === topic.id
                    }
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {topic.title}
                    </span>
                    <Badge
                      variant={
                        topic.lifecycleStatus &&
                        topic.lifecycleStatus !== "active"
                          ? "destructive"
                          : "secondary"
                      }
                      className="capitalize"
                    >
                      {displayStatus.replace("_", " ")}
                    </Badge>
                  </TreeLeafLink>
                );
              })
            ) : (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                No topics yet
              </p>
            )}
          </CollapsibleContent>
        </Collapsible>

        <TreeLeafLink
          href={panelHref(documentId, "logs")}
          icon={<ScrollText className="h-4 w-4 text-muted-foreground" />}
          selected={logsSelected}
        >
          Logs
        </TreeLeafLink>

        <div className="mt-2 rounded-md border border-dashed border-border p-2 text-xs text-muted-foreground">
          <div className="mb-1 flex items-center gap-2 font-medium text-foreground">
            <Database className="h-3.5 w-3.5" />
            RAG Index
          </div>
          Index diagnostics stay on the admin reindex page for this pass.
        </div>
      </nav>
    </>
  );
}

function MobileTreeLink({
  children,
  href,
  selected,
}: {
  children: React.ReactNode;
  href: string;
  selected: boolean;
}) {
  return (
    <Link
      className={cn(
        "rounded-md border border-border px-3 py-2 text-sm font-medium outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        selected
          ? "border-primary/50 bg-primary/10 text-foreground"
          : "bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
      href={href}
    >
      {children}
    </Link>
  );
}

function TreeLeafLink({
  children,
  href,
  icon,
  selected,
}: {
  children: React.ReactNode;
  href: string;
  icon?: React.ReactNode;
  selected: boolean;
}) {
  return (
    <Link
      className={cn(
        "my-1 flex min-h-8 items-center gap-2 rounded-md border border-transparent px-3 py-1.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        selected
          ? "border-l-primary bg-primary/10 text-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
      href={href}
    >
      {icon}
      {children}
    </Link>
  );
}

const branchButtonClassName =
  "group flex min-h-8 w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm font-medium outline-none transition-colors hover:bg-muted focus-visible:border focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function firstTopicHref(documentId: string, topics: DocumentTreeTopic[]) {
  if (topics[0]) {
    return topicHref(documentId, topics[0].id);
  }

  return panelHref(documentId, "topics");
}

function getTopicDisplayStatus(topic: DocumentTreeTopic) {
  if (topic.lifecycleStatus && topic.lifecycleStatus !== "active") {
    return topic.lifecycleStatus;
  }

  return topic.reviewStatus;
}

function panelHref(documentId: string, panel: string) {
  return `/documents/${documentId}?panel=${panel}`;
}

function topicHref(documentId: string, topicId: string) {
  return `/documents/${documentId}?panel=topics&topic=${topicId}`;
}

"use client";

import {
  ChevronDown,
  CircleAlert,
  FileText,
  GitMerge,
  ShieldCheck,
} from "lucide-react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { buildAnswerEvidenceProfile } from "@/lib/chat-evidence-profile";
import type { ChatAnswerEvidenceProfile } from "@/lib/chat-router";
import type { ChatCitation, ChatMessage } from "@/lib/chat-types";
import { cn } from "@/lib/utils";
import { getChatCitationHref } from "@/lib/chat-citation-links";

export function ChatEvidenceCard({ message }: { message: ChatMessage }) {
  const profile =
    message.trace?.answerEvidenceProfile ??
    buildAnswerEvidenceProfile({
      citations: message.citations,
      trace: message.trace,
    });
  const copy = evidenceCardCopy(profile);
  const okfSources = message.citations.filter(
    (citation) => citation.sourceType === "okf",
  );
  const ragSources = message.citations.filter(
    (citation) => citation.sourceType === "rag",
  );

  return (
    <Collapsible>
      <div className={cn("rounded-lg border text-xs", copy.containerClass)}>
        <CollapsibleTrigger
          className={cn(
            "group flex w-full items-center gap-3 px-3 py-2 text-left",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            "[&[data-state=open]_.evidence-chevron]:rotate-180",
          )}
        >
          <copy.Icon className={cn("h-4 w-4 shrink-0", copy.iconClass)} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn("font-mono text-[0.68rem] font-bold uppercase tracking-wider", copy.labelClass)}>
                {copy.label}
              </span>
              <span className="text-muted-foreground">|</span>
              <span className="text-muted-foreground">{copy.description}</span>
            </div>
          </div>
          <span className="font-mono text-[0.68rem] text-muted-foreground">
            {sourceCountLabel(profile)}
          </span>
          <ChevronDown className="evidence-chevron h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform" />
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="border-t border-current/10 px-3 pb-3 pt-2">
            {profile.fallbackReason ? (
              <p className={cn("mb-2 rounded-md px-2 py-1.5", copy.noticeClass)}>
                {profile.fallbackReason}
              </p>
            ) : null}
            {profile.evidenceKind === "mixed" ? (
              <div className="grid gap-3 md:grid-cols-2">
                <SourceGroup
                  citations={okfSources}
                  emptyText="No approved OKF sources in this answer."
                  title="Controlling OKF"
                />
                <SourceGroup
                  citations={ragSources}
                  emptyText="No raw document sources in this answer."
                  title="Supporting raw documents"
                />
              </div>
            ) : (
              <SourceGroup
                citations={message.citations}
                emptyText="No source citations were stored for this answer."
                title={copy.detailTitle}
              />
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function SourceGroup({
  citations,
  emptyText,
  title,
}: {
  citations: ChatCitation[];
  emptyText: string;
  title: string;
}) {
  return (
    <div className="space-y-2">
      <div className="text-[0.68rem] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      {citations.length === 0 ? (
        <p className="text-muted-foreground">{emptyText}</p>
      ) : (
        citations.map((citation) => (
          <CitationSource key={citation.index} citation={citation} />
        ))
      )}
    </div>
  );
}

function CitationSource({ citation }: { citation: ChatCitation }) {
  const href = getChatCitationHref(citation);
  const content = (
    <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[0.625rem] font-bold text-accent-foreground">
                {citation.index}
              </span>
              <span className="font-medium">{citation.documentTitle}</span>
              <span className="text-muted-foreground">
                p. {formatPageRange(citation)}
              </span>
              <span className="rounded-full border border-border px-1.5 py-0.5 font-mono text-[0.625rem] uppercase text-muted-foreground">
                {citation.sourceType === "okf"
                  ? "Approved OKF topic"
                  : "Raw PDF extraction"}
              </span>
            </div>
            {citation.sourceFile || citation.okfFilePath ? (
              <p className="mt-1 text-[0.68rem] text-muted-foreground">
                {citation.sourceFile ? `Source: ${citation.sourceFile}` : null}
                {citation.sourceFile && citation.okfFilePath ? " | " : null}
                {citation.okfFilePath ? `OKF file: ${citation.okfFilePath}` : null}
              </p>
            ) : null}
            <p className="mt-1.5 leading-relaxed text-muted-foreground">
              {citation.text}
            </p>
            {citation.lifecycleNotice ? (
              <p className="mt-2 border-l-2 border-amber-400 pl-2 text-amber-200">
                {citation.lifecycleNotice}
              </p>
            ) : null}
    </>
  );

  const className = "block rounded-md border border-border/70 bg-background/45 p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return href ? (
    <a
      className={cn(className, "transition-colors hover:bg-background/75")}
      href={href}
      rel={citation.sourceType === "rag" ? "noreferrer" : undefined}
      target={citation.sourceType === "rag" ? "_blank" : undefined}
    >
      {content}
    </a>
  ) : (
    <div className={className}>{content}</div>
  );
}

function evidenceCardCopy(profile: ChatAnswerEvidenceProfile) {
  if (profile.evidenceKind === "approved_okf") {
    return {
      Icon: ShieldCheck,
      containerClass: "border-emerald-500/40 bg-emerald-500/5",
      description: "Evidence from curated OKF topics only - highest trust",
      detailTitle: "Approved OKF sources",
      iconClass: "text-emerald-400",
      label: "Approved - OKF",
      labelClass: "text-emerald-300",
      noticeClass: "bg-emerald-500/10 text-emerald-100",
    };
  }

  if (profile.evidenceKind === "raw_rag") {
    return {
      Icon: FileText,
      containerClass: "border-amber-500/45 bg-amber-500/5",
      description: "Unreviewed extracts - verify against the source before relying on them",
      detailTitle: "Raw document sources",
      iconClass: "text-amber-400",
      label: "Raw document",
      labelClass: "text-amber-300",
      noticeClass: "bg-amber-500/10 text-amber-100",
    };
  }

  if (profile.evidenceKind === "mixed") {
    return {
      Icon: GitMerge,
      containerClass: "border-violet-500/45 bg-violet-500/5",
      description: "OKF governs; raw documents support context",
      detailTitle: "Mixed sources",
      iconClass: "text-violet-400",
      label: "Mixed sources",
      labelClass: "text-violet-300",
      noticeClass: "bg-violet-500/10 text-violet-100",
    };
  }

  return {
    Icon: CircleAlert,
    containerClass: "border-destructive/45 bg-destructive/5",
    description: "No supporting evidence found - clarify or refuse",
    detailTitle: "Evidence search result",
    iconClass: "text-destructive",
    label: "No evidence",
    labelClass: "text-destructive",
    noticeClass: "bg-destructive/10 text-destructive",
  };
}

function sourceCountLabel(profile: ChatAnswerEvidenceProfile): string {
  if (profile.evidenceKind === "none") {
    return profile.sourceCounts.total > 0
      ? `${profile.sourceCounts.total} related`
      : "0 results";
  }

  if (profile.evidenceKind === "raw_rag") {
    return `${profile.sourceCounts.rag} chunks`;
  }

  return `${profile.sourceCounts.total} sources`;
}

function formatPageRange(citation: ChatCitation): string {
  return citation.pageStart === citation.pageEnd
    ? `${citation.pageStart}`
    : `${citation.pageStart}-${citation.pageEnd}`;
}

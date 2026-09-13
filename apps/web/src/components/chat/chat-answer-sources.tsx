import { BookOpen, FileText, ArrowUpRight } from "lucide-react";
import { getChatMessageCitationHref } from "../../lib/chat-citation-links";
import type { ChatCitation, ChatMessage } from "../../lib/chat-types";

export function ChatAnswerSources({ message }: { message: ChatMessage }) {
  if (!message.citations.length) return null;
  return (
    <section aria-label="Answer sources" className="space-y-2">
      <h3 className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><BookOpen className="h-4 w-4" />Sources <span>{message.citations.length}</span></h3>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {message.citations.slice(0, 3).map(citation => <SourceCard key={citation.index} citation={citation} sessionId={message.sessionId} />)}
      </div>
      {message.citations.length > 3 && <details>
        <summary className="w-fit cursor-pointer rounded-sm text-xs text-muted-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">All {message.citations.length} sources</summary>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {message.citations.slice(3).map(citation => <SourceCard key={citation.index} citation={citation} sessionId={message.sessionId} />)}
        </div>
      </details>}
    </section>
  );
}

function SourceCard({ citation, sessionId }: { citation: ChatCitation; sessionId: string }) {
  const href = getChatMessageCitationHref(citation, sessionId);
  const label = !href ? "Source unavailable" : citation.sourceType === "rag" ? "Unreviewed document"
    : citation.approvalProvenance === "human" ? "Human-approved OKF"
    : citation.approvalProvenance === "automated" ? "Automation-approved OKF" : "Legacy-approved OKF";
  const pages = citation.pageStart > 0 ? `p. ${citation.pageStart}${citation.pageEnd > citation.pageStart ? `-${citation.pageEnd}` : ""}` : "";
  const content = <>
    <div className="flex items-start gap-2"><FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" /><span className="line-clamp-2 min-h-8 min-w-0 flex-1 break-words text-xs font-medium">{citation.documentTitle}</span><span className="text-xs text-muted-foreground">{citation.index}</span></div>
    <div className="mt-2 flex items-center justify-between gap-2 text-[11px]"><span className={citation.sourceType === "rag" || !href ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400"}>{label}</span>{href && <ArrowUpRight className="h-3 w-3 shrink-0 text-muted-foreground" />}</div>
    <p className="mt-1 truncate text-[11px] text-muted-foreground" title={citation.knowledgeBundleName}>{[citation.knowledgeBundleName, pages].filter(Boolean).join(" / ")}</p>
    {citation.okfEvidenceMode === "graph" && <p className="mt-1 text-[11px] text-muted-foreground">Graph-supported</p>}
    {citation.lifecycleNotice && <p className="mt-1 break-words text-[11px] text-muted-foreground">{citation.lifecycleNotice}</p>}
  </>;
  const className = "min-w-0 rounded-lg border border-border bg-muted/20 p-3";
  return href ? <a className={`${className} transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`} href={href} title={citation.documentTitle} target={citation.sourceType === "rag" ? "_blank" : undefined} rel={citation.sourceType === "rag" ? "noreferrer" : undefined}>{content}</a> : <div className={className}>{content}</div>;
}

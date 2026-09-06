"use client";

import { BadgePlus, FileSearch } from "lucide-react";

import { promoteChatEntityCandidateAction } from "@/app/(app)/chat/actions";
import type { ChatEntityCandidate } from "@/lib/chat-router";
import { PendingSubmitButton } from "@/components/pending-submit-button";

export function ChatEntityCandidates({
  candidates,
  messageId,
  sessionId,
}: {
  candidates: ChatEntityCandidate[];
  messageId: string;
  sessionId: string;
}) {
  if (candidates.length === 0) return null;

  return (
    <div className="border-l-2 border-sky-400/70 pl-3">
      <div className="mb-2 flex items-center gap-2">
        <FileSearch className="h-4 w-4 text-sky-300" />
        <p className="text-xs font-medium uppercase text-sky-200">
          Entities noticed in the evidence
        </p>
      </div>
      <div className="grid gap-2">
        {candidates.map((candidate) => (
          <div
            className="flex flex-col gap-3 border-b border-border/70 py-2 last:border-b-0 sm:flex-row sm:items-start sm:justify-between"
            key={candidate.id}
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium">{candidate.name}</p>
                <span className="font-mono text-[0.65rem] uppercase text-muted-foreground">
                  {candidate.entityType}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {candidate.summary}
              </p>
              <p className="mt-1 line-clamp-2 text-xs italic text-muted-foreground">
                Evidence [{candidate.citationIndex}]: “{candidate.evidenceQuote}”
              </p>
            </div>
            <form action={promoteChatEntityCandidateAction} className="shrink-0">
              <input name="candidateId" type="hidden" value={candidate.id} />
              <input name="messageId" type="hidden" value={messageId} />
              <input name="sessionId" type="hidden" value={sessionId} />
              <PendingSubmitButton pendingLabel="Opening review...">
                <BadgePlus className="mr-2 h-4 w-4" />
                Review and enrich
              </PendingSubmitButton>
            </form>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[0.7rem] text-muted-foreground">
        Suggestions are not approved knowledge. Review, enrich, and approve them
        before they can be used by the agent.
      </p>
    </div>
  );
}

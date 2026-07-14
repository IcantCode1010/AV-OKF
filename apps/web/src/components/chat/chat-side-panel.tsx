import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ChatMessage } from "@/lib/chat-types";

export function ChatSidePanelContent({
  latestAssistantMessage,
}: {
  latestAssistantMessage: ChatMessage | null;
}) {
  const citations = latestAssistantMessage?.citations ?? [];
  const trace = latestAssistantMessage?.trace;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Sources</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {citations.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No sources for this reply.
            </p>
          ) : (
            citations.map((citation) => (
              <div
                key={citation.index}
                className="rounded-lg border border-border p-2 text-xs"
              >
                <div className="flex items-center gap-1.5">
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[0.625rem] font-bold text-accent-foreground">
                    {citation.index}
                  </span>
                  <span className="font-medium">{citation.documentTitle}</span>
                </div>
                <Badge variant="secondary" className="mt-1.5">
                  {citation.sourceType === "okf" ? "OKF topic" : "raw extraction"}
                </Badge>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Trace</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {trace ? (
            <>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">{formatRoute(trace.route)}</Badge>
                <Badge variant="outline">{trace.confidence} confidence</Badge>
                {trace.answerMode ? (
                  <Badge variant="outline">
                    {trace.answerMode === "llm"
                      ? `LLM answer${trace.answerModel ? ` · ${trace.answerModel}` : ""}`
                      : "Excerpt answer"}
                  </Badge>
                ) : null}
              </div>
              <TraceRow label="Category" value={formatLabel(trace.queryCategory)} />
              <TraceRow label="Rationale" value={trace.rationale} />
              {trace.queryUnderstanding ? (
                <>
                  <TraceRow
                    label="Query handling"
                    value={formatLabel(trace.queryUnderstanding.rewriteMode)}
                  />
                  {trace.queryUnderstanding.retrievalQuery !==
                  trace.queryUnderstanding.originalQuestion ? (
                    <TraceRow
                      label="Optimized search query"
                      value={trace.queryUnderstanding.retrievalQuery}
                    />
                  ) : null}
                  <TraceRow
                    label="Ambiguity"
                    value={formatLabel(trace.queryUnderstanding.ambiguityLevel)}
                  />
                  {trace.queryUnderstanding.detectedEntities.length > 0 ? (
                    <TraceRow
                      label="Preserved entities"
                      value={trace.queryUnderstanding.detectedEntities.join(", ")}
                    />
                  ) : null}
                  {trace.queryUnderstanding.routeConflict ? (
                    <TraceRow
                      label="Route conflict"
                      value={`Kept ${formatRoute(trace.queryUnderstanding.routeConflict.originalRoute)}; optimized query suggested ${formatRoute(trace.queryUnderstanding.routeConflict.optimizedRoute)}.`}
                    />
                  ) : null}
                </>
              ) : null}
              {trace.requiredContext.length > 0 ? (
                <TraceRow
                  label="Required context"
                  value={trace.requiredContext.map(formatLabel).join(", ")}
                />
              ) : null}
              <TraceRow
                label="Tools called"
                value={
                  trace.retrievalToolsCalled.length > 0
                    ? trace.retrievalToolsCalled.join(", ")
                    : "None for this route"
                }
              />
              {trace.sourcesRead.length > 0 ? (
                <TraceRow label="Sources read" value={trace.sourcesRead.join(", ")} />
              ) : null}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              Trace will appear after a router decision is stored.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function TraceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <div className="text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-xs leading-relaxed">{value}</div>
    </div>
  );
}

function formatRoute(route: string): string {
  if (route === "okf_only") {
    return "Routed to OKF";
  }

  if (route === "rag_only") {
    return "Routed to RAG";
  }

  if (route === "hybrid") {
    return "Routed to Hybrid";
  }

  if (route === "missing_context") {
    return "Missing context";
  }

  if (route === "unsupported") {
    return "Unsupported";
  }

  return formatLabel(route);
}

function formatLabel(value: string): string {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

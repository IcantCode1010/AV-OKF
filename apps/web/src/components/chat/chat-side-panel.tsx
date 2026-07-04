import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ChatMessage } from "@/lib/chat-types";

export function ChatSidePanelContent({
  latestAssistantMessage,
}: {
  latestAssistantMessage: ChatMessage | null;
}) {
  const citations = latestAssistantMessage?.citations ?? [];

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Sources</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {citations.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No sources yet — this is a stubbed reply.
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
        <CardContent>
          <p className="text-xs text-muted-foreground">
            Trace will appear here once the query router ships (route, query
            category, confidence, and rationale).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

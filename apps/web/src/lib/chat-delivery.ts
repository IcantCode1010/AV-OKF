import { z } from "zod";
import type { ChatMessage } from "./chat-types.ts";

export const chatStageSchema = z.enum(["searching", "answering", "validating", "saving"]);
export type ChatDeliveryStage = z.infer<typeof chatStageSchema>;
export const CHAT_STAGE_LABELS: Record<ChatDeliveryStage, string> = {
  searching: "Searching selected knowledge and source evidence",
  answering: "Writing the answer",
  validating: "Checking the answer against its evidence",
  saving: "Saving the conversation",
};
export const chatSendSchema = z.object({
  content: z.string().trim().min(1).max(16000),
  metadataSelection: z.array(z.object({ field: z.string().max(200), label: z.string().max(500), value: z.string().max(1000) })).max(30).optional(),
});
const messageSchema = z.object({
  id: z.string(), sessionId: z.string(), role: z.enum(["user", "assistant"]),
  content: z.string(), createdAt: z.string(), scopeVersion: z.number(),
  knowledgeBundleIds: z.array(z.string()), citations: z.array(z.object({
    index: z.number(), sourceType: z.enum(["okf", "rag"]), documentTitle: z.string(),
    pageStart: z.number(), pageEnd: z.number(), text: z.string(),
  }).passthrough()), trace: z.record(z.string(), z.unknown()).nullable(),
});
export const chatDeliveryEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("progress"), stage: chatStageSchema }),
  z.object({ type: z.literal("heartbeat") }),
  z.object({ type: z.literal("complete"), userMessage: messageSchema.extend({ role: z.literal("user") }), assistantMessage: messageSchema.extend({ role: z.literal("assistant") }) }),
  z.object({ type: z.literal("error"), message: z.string().max(500) }),
]);
export const chatHistorySchema = z.object({ messages: z.array(messageSchema) });
export class ChatDeliveryFailure extends Error {}
export type ChatDeliveryEvent =
  | { type: "progress"; stage: ChatDeliveryStage }
  | { type: "heartbeat" }
  | { type: "complete"; userMessage: ChatMessage; assistantMessage: ChatMessage }
  | { type: "error"; message: string };

// A result is emitted only after generation, validation and persistence finish.
// Cancelling the connection stops delivery, not an already-running model call.
export function createChatDeliveryStream(run: (progress: (stage: ChatDeliveryStage) => void) => Promise<{userMessage: ChatMessage; assistantMessage: ChatMessage}>, heartbeatMs = 5000) {
  let closed = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: ChatDeliveryEvent) => {
        if (!closed) controller.enqueue(new TextEncoder().encode(`${JSON.stringify(event)}\n`));
      };
      timer = setInterval(() => emit({ type: "heartbeat" }), heartbeatMs);
      try {
        emit({ type: "progress", stage: "searching" });
        const result = await run((stage) => emit({ type: "progress", stage }));
        emit({ type: "complete", ...result });
      } catch {
        emit({ type: "error", message: "The answer could not be completed. Check your knowledge sources and try again." });
      } finally {
        clearInterval(timer);
        if (!closed) { closed = true; controller.close(); }
      }
    },
    cancel() { closed = true; clearInterval(timer); },
  });
}

export async function readChatDelivery(response: Response, onEvent: (event: ChatDeliveryEvent) => void) {
  if (!response.ok && response.status >= 400 && response.status < 500) throw new ChatDeliveryFailure("The message was not accepted. Check your session and knowledge sources before trying again.");
  if (!response.ok || !response.body) throw new Error("chat_delivery_unavailable");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = "", completed = false;
  const consume = (line: string) => {
    const event = chatDeliveryEventSchema.parse(JSON.parse(line)) as ChatDeliveryEvent;
    if (completed) throw new Error("chat_delivery_after_complete");
    if (event.type === "error") throw new ChatDeliveryFailure(event.message);
    if (event.type === "complete") completed = true;
    onEvent(event);
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > 8_000_000) throw new Error("chat_delivery_too_large");
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        if (line.trim()) consume(line);
      }
      if (done) break;
    }
    if (buffer.trim()) consume(buffer);
    if (!completed) throw new Error("chat_delivery_interrupted");
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export function findRecoveredChatReply(messages: ChatMessage[], afterId: string | null, question: string) {
  const start = afterId ? messages.findIndex((message) => message.id === afterId) : -1;
  if (afterId && start < 0) return undefined;
  for (let index = start + 1; index < messages.length - 1; index++) {
    if (messages[index].role === "user" && messages[index].content === question && messages[index + 1].role === "assistant") return messages[index + 1];
  }
}

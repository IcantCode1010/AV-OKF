import { requireAuthWorkspaceContext } from "@/lib/auth-workspace";
import { getChatSessionWorkspaceId, getChatSessionWithMessages, sendChatMessage } from "@/lib/chat-backend";
import { chatSendSchema, createChatDeliveryStream } from "@/lib/chat-delivery";

export const runtime = "nodejs";
export const maxDuration = 600;
const headers = { "Cache-Control": "private, no-store" };
type RouteContext = { params: Promise<{ id: string }> };

async function authorized(id: string) {
  const context = await requireAuthWorkspaceContext();
  return await getChatSessionWorkspaceId(id) === context.workspaceId;
}

export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    if (!await authorized(id)) return new Response(null, { status: 404, headers });
    const history = await getChatSessionWithMessages(id);
    if (!history) return new Response(null, { status: 404, headers });
    return Response.json({ messages: history.messages }, { headers });
  } catch { return new Response(null, { status: 401, headers }); }
}

export async function POST(request: Request, { params }: RouteContext) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return new Response(null, { status: 403, headers });
  const { id } = await params;
  try {
    if (!await authorized(id)) return new Response(null, { status: 404, headers });
  } catch { return new Response(null, { status: 401, headers }); }
  const input = chatSendSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return new Response("Invalid chat message.", { status: 400, headers });
  return new Response(createChatDeliveryStream((progress) => sendChatMessage(id, input.data.content, input.data.metadataSelection, progress)), {
    headers: { ...headers, "Content-Type": "application/x-ndjson; charset=utf-8", "X-Accel-Buffering": "no" },
  });
}

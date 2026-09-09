import type { PublisherConfig } from "./types.ts";

export function loadPublisherConfig(env: NodeJS.ProcessEnv = process.env): PublisherConfig {
  const endpoint = env.EFB_PUBLISHER_URL?.trim();
  const token = env.EFB_PUBLISHER_TOKEN?.trim();
  if (!endpoint || !token) throw Error("efb_publisher_not_configured");
  const url = new URL(endpoint);
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname))
    throw Error("efb_publisher_https_required");
  return { endpoint: url.toString(), token };
}

export function createPublisherApi(config: PublisherConfig, fetcher: typeof fetch = fetch) {
  return async (body: Record<string, unknown>) => {
    const response = await fetcher(config.endpoint, { method: "POST", headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json() as { result?: unknown; error?: string };
    if (!response.ok) throw Error(payload.error ?? "efb_publisher_request_failed");
    return payload.result;
  };
}

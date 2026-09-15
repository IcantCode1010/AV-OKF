import type { PublisherConfig } from "./types.ts";

export function loadPublisherConfig(env: NodeJS.ProcessEnv = process.env): PublisherConfig {
  const endpoint = env.EFB_PUBLISHER_URL?.trim();
  const token = env.EFB_PUBLISHER_TOKEN?.trim();
  const credentials = env.EFB_PUBLISHER_AUTH_URL && env.EFB_PUBLISHER_PUBLIC_KEY && env.EFB_PUBLISHER_EMAIL && env.EFB_PUBLISHER_PASSWORD
    ? { url: env.EFB_PUBLISHER_AUTH_URL.trim(), publicKey: env.EFB_PUBLISHER_PUBLIC_KEY.trim(), email: env.EFB_PUBLISHER_EMAIL.trim(), password: env.EFB_PUBLISHER_PASSWORD } : undefined;
  if (!endpoint || (!token && !credentials)) throw Error("efb_publisher_not_configured");
  const url = new URL(endpoint);
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname))
    throw Error("efb_publisher_https_required");
  if (credentials && new URL(credentials.url).protocol !== "https:") throw Error("efb_publisher_auth_https_required");
  return { endpoint: url.toString(), token, credentials };
}

export function publisherIsConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  try { loadPublisherConfig(env); return true; } catch { return false; }
}

export function createPublisherApi(config: PublisherConfig, fetcher: typeof fetch = fetch) {
  let session: { token: string; expiresAt: number } | undefined;
  let signingIn: Promise<string> | undefined;
  async function bearer(): Promise<string> {
    if (config.token) return config.token;
    if (session && session.expiresAt > Date.now() + 60_000) return session.token;
    if (signingIn) return signingIn;
    signingIn = (async () => {
      const credentials = config.credentials;
      if (!credentials) throw Error("efb_publisher_not_configured");
      const response = await fetcher(new URL("/auth/v1/token?grant_type=password", credentials.url), {
        method: "POST", redirect: "error", headers: { apikey: credentials.publicKey, "Content-Type": "application/json" },
        body: JSON.stringify({ email: credentials.email, password: credentials.password }),
      });
      if (!response.ok) throw Error("efb_publisher_sign_in_failed");
      const data = await response.json() as { access_token?: string; expires_in?: number };
      if (!data.access_token || typeof data.expires_in !== "number" || data.expires_in <= 60) throw Error("efb_publisher_sign_in_failed");
      session = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
      return session.token;
    })();
    try { return await signingIn; } finally { signingIn = undefined; }
  }
  return async (body: Record<string, unknown>) => {
    const send = async () => fetcher(config.endpoint, { method: "POST", redirect: "error", headers: { Authorization: `Bearer ${await bearer()}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    let response = await send();
    // A rejected session has not entered the receiver's publication dispatch.
    if (response.status === 401 && !config.token && config.credentials) { session = undefined; response = await send(); }
    const payload = await response.json() as { result?: unknown; error?: string };
    if (!response.ok) throw Error(payload.error ?? "efb_publisher_request_failed");
    return payload.result;
  };
}

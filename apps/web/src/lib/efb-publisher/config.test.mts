import assert from "node:assert/strict";
import test from "node:test";
import { createPublisherApi, loadPublisherConfig, publisherIsConfigured } from "./config.ts";

const env = { EFB_PUBLISHER_URL: "https://efb.example/api/publish", EFB_PUBLISHER_AUTH_URL: "https://auth.example", EFB_PUBLISHER_PUBLIC_KEY: "public-key", EFB_PUBLISHER_EMAIL: "publisher@example.com", EFB_PUBLISHER_PASSWORD: "secret" };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

test("publisher accepts complete credentials and rejects incomplete or insecure configuration", () => {
  assert.equal(publisherIsConfigured(env), true);
  assert.equal(publisherIsConfigured({ ...env, EFB_PUBLISHER_PASSWORD: "" }), false);
  assert.equal(publisherIsConfigured({ ...env, EFB_PUBLISHER_AUTH_URL: "http://auth.example" }), false);
});

test("publisher signs in once and reuses the session across publication actions", async () => {
  let signIns = 0;
  const api = createPublisherApi(loadPublisherConfig(env), (async (url, init) => {
    if (String(url).startsWith(env.EFB_PUBLISHER_AUTH_URL)) {
      signIns++;
      assert.equal(init?.redirect, "error");
      assert.deepEqual(JSON.parse(String(init?.body)), { email: env.EFB_PUBLISHER_EMAIL, password: env.EFB_PUBLISHER_PASSWORD });
      return json({ access_token: "session", expires_in: 3600 });
    }
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer session");
    return json({ result: "ok" });
  }) as typeof fetch);
  assert.equal(await api({ action: "inspect" }), "ok");
  assert.equal(await api({ action: "inspect" }), "ok");
  assert.equal(signIns, 1);
});

test("publisher renews a rejected session once without retrying permission failures", async () => {
  let signIns = 0, calls = 0;
  const api = createPublisherApi(loadPublisherConfig(env), (async (url) => {
    if (String(url).startsWith(env.EFB_PUBLISHER_AUTH_URL)) return json({ access_token: `session-${++signIns}`, expires_in: 3600 });
    calls++;
    return calls === 1 ? json({ error: "SIGN_IN_REQUIRED" }, 401) : json({ error: "PUBLISHER_REQUIRED" }, 403);
  }) as typeof fetch);
  await assert.rejects(api({ action: "inspect" }), /PUBLISHER_REQUIRED/);
  assert.equal(calls, 2);
  assert.equal(signIns, 2);
});

test("sign-in failures do not expose provider details or call the publisher", async () => {
  let calls = 0;
  const api = createPublisherApi(loadPublisherConfig(env), (async () => { calls++; return json({ error: "sensitive provider details" }, 400); }) as typeof fetch);
  await assert.rejects(api({ action: "inspect" }), /^Error: efb_publisher_sign_in_failed$/);
  assert.equal(calls, 1);
});

test("explicit bearer tokens remain supported without sign-in", async () => {
  const api = createPublisherApi(loadPublisherConfig({ EFB_PUBLISHER_URL: env.EFB_PUBLISHER_URL, EFB_PUBLISHER_TOKEN: "explicit-token" }), (async (url, init) => {
    assert.equal(url, env.EFB_PUBLISHER_URL);
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer explicit-token");
    return json({ result: "ok" });
  }) as typeof fetch);
  assert.equal(await api({ action: "inspect" }), "ok");
});

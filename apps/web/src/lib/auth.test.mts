import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAuthProviderIds,
  getAuthSessionStrategy,
  isValidTestAuthPassword,
} from "./auth.ts";

test("buildAuthProviderIds only exposes test credentials when explicitly enabled", () => {
  assert.deepEqual(buildAuthProviderIds({ AV_OKF_TEST_AUTH_ENABLED: "false" }), []);
  assert.deepEqual(buildAuthProviderIds({ AV_OKF_TEST_AUTH_ENABLED: "true" }), [
    "credentials",
  ]);
});

test("buildAuthProviderIds includes configured OAuth providers alongside test auth", () => {
  assert.deepEqual(
    buildAuthProviderIds({
      AUTH_GITHUB_ID: "github-id",
      AUTH_GITHUB_SECRET: "github-secret",
      AUTH_GOOGLE_ID: "google-id",
      AUTH_GOOGLE_SECRET: "google-secret",
      AV_OKF_TEST_AUTH_ENABLED: "true",
    }),
    ["github", "google", "credentials"],
  );
});

test("getAuthSessionStrategy uses JWT only for credentials test auth", () => {
  assert.equal(getAuthSessionStrategy({}), "database");
  assert.equal(getAuthSessionStrategy({ AV_OKF_TEST_AUTH_ENABLED: "true" }), "jwt");
});

test("isValidTestAuthPassword checks the configured local test password", () => {
  const env = {
    AV_OKF_TEST_AUTH_PASSWORD: "local-only-password",
  };

  assert.equal(isValidTestAuthPassword("local-only-password", env), true);
  assert.equal(isValidTestAuthPassword("wrong", env), false);
  assert.equal(isValidTestAuthPassword(undefined, env), false);
});

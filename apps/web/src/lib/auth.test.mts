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

test("test auth enabled in production with default password throws", () => {
  assert.throws(
    () =>
      buildAuthProviderIds({
        AV_OKF_TEST_AUTH_ENABLED: "true",
        NODE_ENV: "production",
      }),
    /test_auth_blocked_in_production: set a non-default AV_OKF_TEST_AUTH_PASSWORD or disable test auth/,
  );
});

test("test auth enabled in production with custom password does not throw", () => {
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (message?: unknown) => {
    warnings.push(String(message));
  };

  try {
    const env = {
      AV_OKF_TEST_AUTH_ENABLED: "true",
      AV_OKF_TEST_AUTH_PASSWORD: "custom-production-smoke-password",
      NODE_ENV: "production",
    };

    assert.deepEqual(buildAuthProviderIds(env), ["credentials"]);
    assert.deepEqual(buildAuthProviderIds(env), ["credentials"]);
    assert.deepEqual(warnings, [
      "test_auth_enabled_in_production: local test credentials are enabled with a non-default password",
    ]);
  } finally {
    console.warn = originalWarn;
  }
});

test("test auth enabled in development with default password does not throw", () => {
  assert.deepEqual(
    buildAuthProviderIds({
      AV_OKF_TEST_AUTH_ENABLED: "true",
      NODE_ENV: "development",
    }),
    ["credentials"],
  );
});

test("isValidTestAuthPassword checks the configured local test password", () => {
  const env = {
    AV_OKF_TEST_AUTH_PASSWORD: "local-only-password",
  };

  assert.equal(isValidTestAuthPassword("local-only-password", env), true);
  assert.equal(isValidTestAuthPassword("wrong", env), false);
  assert.equal(isValidTestAuthPassword(undefined, env), false);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  __llmProviderSettingsTestHooks,
  clearWorkspaceLlmApiKey,
  getWorkspaceLlmSetting,
  saveWorkspaceLlmApiKey,
} from "./llm-provider-settings.ts";

type StoredSetting = {
  encryptedApiKey: string | null;
  provider: string;
  updatedAt: Date;
  updatedBy: string | null;
  workspaceId: string;
};

function createFakeSettingsClient() {
  const rows = new Map<string, StoredSetting>();

  return {
    rows,
    client: {
      workspaceLlmSetting: {
        async deleteMany(input: { where: { workspaceId: string } }) {
          const existed = rows.delete(input.where.workspaceId);
          return { count: existed ? 1 : 0 };
        },
        async findUnique(input: { where: { workspaceId: string } }) {
          return rows.get(input.where.workspaceId) ?? null;
        },
        async upsert(input: {
          create: StoredSetting;
          update: Omit<StoredSetting, "workspaceId">;
          where: { workspaceId: string };
        }) {
          const existing = rows.get(input.where.workspaceId);
          const next = existing
            ? { ...existing, ...input.update }
            : { ...input.create };
          rows.set(input.where.workspaceId, next);
          return next;
        },
      },
    },
  };
}

const encryptionEnv = {
  AV_OKF_SETTINGS_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef",
  NODE_ENV: "test",
};

test("workspace LLM key is encrypted at rest and public reads never expose secrets", async () => {
  const { client, rows } = createFakeSettingsClient();

  await saveWorkspaceLlmApiKey("wrk_1", "anthropic", " sk-ant-secret ", {
    client,
    env: encryptionEnv,
    updatedBy: "usr_1",
  });

  const row = rows.get("wrk_1");
  assert.ok(row);
  assert.notEqual(row.encryptedApiKey, "sk-ant-secret");
  assert.match(row.encryptedApiKey ?? "", /^v1:/);
  assert.equal(
    __llmProviderSettingsTestHooks.decryptStoredApiKey(
      row.encryptedApiKey ?? "",
      encryptionEnv,
    ),
    "sk-ant-secret",
  );

  const publicSetting = await getWorkspaceLlmSetting("wrk_1", { client });
  assert.equal(publicSetting.provider, "anthropic");
  assert.equal(publicSetting.hasKey, true);
  assert.equal("encryptedApiKey" in publicSetting, false);
  assert.equal("rawKey" in publicSetting, false);
});

test("workspace LLM key rejects empty saves and clears back to hasKey false", async () => {
  const { client } = createFakeSettingsClient();

  await assert.rejects(
    () =>
      saveWorkspaceLlmApiKey("wrk_1", "anthropic", "   ", {
        client,
        env: encryptionEnv,
        updatedBy: "usr_1",
      }),
    /llm_api_key_required/,
  );

  await saveWorkspaceLlmApiKey("wrk_1", "anthropic", "sk-ant-secret", {
    client,
    env: encryptionEnv,
    updatedBy: "usr_1",
  });
  assert.equal((await getWorkspaceLlmSetting("wrk_1", { client })).hasKey, true);

  await clearWorkspaceLlmApiKey("wrk_1", { client });
  assert.deepEqual(await getWorkspaceLlmSetting("wrk_1", { client }), {
    hasKey: false,
    provider: "anthropic",
    updatedAt: null,
    updatedBy: null,
  });
});

test("workspace LLM settings accept OpenAI and reject unsupported providers", async () => {
  const { client } = createFakeSettingsClient();

  const saved = await saveWorkspaceLlmApiKey("wrk_1", "openai", "sk-openai", {
    client,
    env: encryptionEnv,
    updatedBy: "usr_1",
  });

  assert.equal(saved.provider, "openai");
  assert.equal(saved.hasKey, true);

  await assert.rejects(
    () =>
      saveWorkspaceLlmApiKey("wrk_1", "grok", "sk-grok", {
        client,
        env: encryptionEnv,
        updatedBy: "usr_1",
      }),
    /unsupported_llm_provider/,
  );
});

test("switching providers replaces the single active provider and key", async () => {
  const { client, rows } = createFakeSettingsClient();

  await saveWorkspaceLlmApiKey("wrk_1", "anthropic", "sk-ant-secret", {
    client,
    env: encryptionEnv,
    updatedBy: "usr_1",
  });
  await saveWorkspaceLlmApiKey("wrk_1", "openai", "sk-openai-secret", {
    client,
    env: encryptionEnv,
    updatedBy: "usr_1",
  });

  assert.equal(rows.size, 1);
  const row = rows.get("wrk_1");
  assert.ok(row);
  assert.equal(row.provider, "openai");
  assert.equal(
    __llmProviderSettingsTestHooks.decryptStoredApiKey(
      row.encryptedApiKey ?? "",
      encryptionEnv,
    ),
    "sk-openai-secret",
  );
  assert.notEqual(
    __llmProviderSettingsTestHooks.decryptStoredApiKey(
      row.encryptedApiKey ?? "",
      encryptionEnv,
    ),
    "sk-ant-secret",
  );
});

test("missing production encryption key fails when LLM settings storage is used", async () => {
  const { client } = createFakeSettingsClient();

  await assert.rejects(
    () =>
      saveWorkspaceLlmApiKey("wrk_1", "anthropic", "sk-ant-secret", {
        client,
        env: { NODE_ENV: "production" },
        updatedBy: "usr_1",
      }),
    /settings_encryption_key_required/,
  );
});

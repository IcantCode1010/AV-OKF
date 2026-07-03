import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

import type { AuthWorkspaceContext } from "./auth-workspace.ts";
import {
  getLlmProvider,
  LLM_PROVIDERS,
  type LlmProviderId,
} from "./llm-providers.ts";
import { getPrisma } from "./prisma.ts";

type LlmSettingsEnv = Record<string, string | undefined>;

type WorkspaceLlmSettingRow = {
  encryptedApiKey: string | null;
  provider: string;
  updatedAt: Date;
  updatedBy: string | null;
  workspaceId: string;
};

type WorkspaceLlmSettingsClient = {
  workspaceLlmSetting: {
    deleteMany(input: { where: { workspaceId: string } }): Promise<{ count: number }>;
    findUnique(input: {
      where: { workspaceId: string };
    }): Promise<WorkspaceLlmSettingRow | null>;
    upsert(input: {
      create: WorkspaceLlmSettingRow;
      update: Omit<WorkspaceLlmSettingRow, "workspaceId">;
      where: { workspaceId: string };
    }): Promise<WorkspaceLlmSettingRow>;
  };
};

type LlmSettingsOptions = {
  client?: WorkspaceLlmSettingsClient;
  env?: LlmSettingsEnv;
  updatedBy?: string;
};

export type WorkspaceLlmSettingSummary = {
  hasKey: boolean;
  provider: LlmProviderId;
  updatedAt: string | null;
  updatedBy: string | null;
};

const DEFAULT_PROVIDER = LLM_PROVIDERS[0].id;
const ENCRYPTION_VERSION = "v1";

export function assertLlmSettingsWorkspace(input: {
  context: AuthWorkspaceContext;
  targetWorkspaceId: string;
}): void {
  if (input.context.workspaceId !== input.targetWorkspaceId) {
    throw new Error("llm_settings_workspace_mismatch");
  }
}

export async function getWorkspaceLlmSetting(
  workspaceId: string,
  options: Pick<LlmSettingsOptions, "client"> = {},
): Promise<WorkspaceLlmSettingSummary> {
  const row = await getSettingsClient(options.client).workspaceLlmSetting.findUnique({
    where: { workspaceId },
  });

  if (!row) {
    return {
      hasKey: false,
      provider: DEFAULT_PROVIDER,
      updatedAt: null,
      updatedBy: null,
    };
  }

  return {
    hasKey: Boolean(row.encryptedApiKey),
    provider: normalizeProvider(row.provider),
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
  };
}

export async function getWorkspaceLlmApiKeyForEnrichment(
  workspaceId: string,
  options: Pick<LlmSettingsOptions, "client" | "env"> = {},
): Promise<{ apiKey: string; provider: LlmProviderId } | null> {
  const row = await getSettingsClient(options.client).workspaceLlmSetting.findUnique({
    where: { workspaceId },
  });

  if (!row?.encryptedApiKey) {
    return null;
  }

  return {
    apiKey: decryptStoredApiKey(row.encryptedApiKey, options.env),
    provider: normalizeProvider(row.provider),
  };
}

export async function saveWorkspaceLlmApiKey(
  workspaceId: string,
  provider: string,
  rawKey: string,
  options: LlmSettingsOptions = {},
): Promise<WorkspaceLlmSettingSummary> {
  const normalizedProvider = normalizeProvider(provider);
  const normalizedKey = rawKey.trim();

  if (!normalizedKey) {
    throw new Error("llm_api_key_required");
  }

  const now = new Date();
  const row = await getSettingsClient(options.client).workspaceLlmSetting.upsert({
    create: {
      encryptedApiKey: encryptApiKey(normalizedKey, options.env),
      provider: normalizedProvider,
      updatedAt: now,
      updatedBy: options.updatedBy ?? null,
      workspaceId,
    },
    update: {
      encryptedApiKey: encryptApiKey(normalizedKey, options.env),
      provider: normalizedProvider,
      updatedAt: now,
      updatedBy: options.updatedBy ?? null,
    },
    where: { workspaceId },
  });

  return toSummary(row);
}

export async function clearWorkspaceLlmApiKey(
  workspaceId: string,
  options: Pick<LlmSettingsOptions, "client"> = {},
): Promise<WorkspaceLlmSettingSummary> {
  await getSettingsClient(options.client).workspaceLlmSetting.deleteMany({
    where: { workspaceId },
  });

  return {
    hasKey: false,
    provider: DEFAULT_PROVIDER,
    updatedAt: null,
    updatedBy: null,
  };
}

function encryptApiKey(rawKey: string, env: LlmSettingsEnv = process.env): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getSettingsEncryptionKey(env), iv);
  const ciphertext = Buffer.concat([
    cipher.update(rawKey, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    ENCRYPTION_VERSION,
    iv.toString("base64url"),
    authTag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

function decryptStoredApiKey(
  encryptedValue: string,
  env: LlmSettingsEnv = process.env,
): string {
  const [version, ivValue, authTagValue, ciphertextValue] =
    encryptedValue.split(":");

  if (
    version !== ENCRYPTION_VERSION ||
    !ivValue ||
    !authTagValue ||
    !ciphertextValue
  ) {
    throw new Error("invalid_llm_api_key_ciphertext");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    getSettingsEncryptionKey(env),
    Buffer.from(ivValue, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(authTagValue, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function getSettingsEncryptionKey(env: LlmSettingsEnv = process.env): Buffer {
  const secret = env.AV_OKF_SETTINGS_ENCRYPTION_KEY?.trim();

  if (!secret) {
    if (env.NODE_ENV === "production" || env.AV_OKF_BACKEND === "production") {
      throw new Error(
        "settings_encryption_key_required: set AV_OKF_SETTINGS_ENCRYPTION_KEY before saving LLM provider settings",
      );
    }

    return createHash("sha256")
      .update("av-okf-local-development-settings-key")
      .digest();
  }

  return createHash("sha256").update(secret).digest();
}

function normalizeProvider(provider: string): LlmProviderId {
  const normalized = provider.trim().toLowerCase();
  return getLlmProvider(normalized).id;
}

function getSettingsClient(
  client?: WorkspaceLlmSettingsClient,
): WorkspaceLlmSettingsClient {
  return client ?? getPrisma();
}

function toSummary(row: WorkspaceLlmSettingRow): WorkspaceLlmSettingSummary {
  return {
    hasKey: Boolean(row.encryptedApiKey),
    provider: normalizeProvider(row.provider),
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
  };
}

export const __llmProviderSettingsTestHooks = {
  decryptStoredApiKey,
};

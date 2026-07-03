CREATE TABLE "WorkspaceLlmSetting" (
    "workspaceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'anthropic',
    "encryptedApiKey" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" TEXT,

    CONSTRAINT "WorkspaceLlmSetting_pkey" PRIMARY KEY ("workspaceId")
);

ALTER TABLE "WorkspaceLlmSetting"
ADD CONSTRAINT "WorkspaceLlmSetting_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

import assert from "node:assert/strict";
import test from "node:test";

import { assertLlmSettingsWorkspace } from "../../../lib/llm-provider-settings.ts";

const context = {
  role: "admin" as const,
  userId: "usr_1",
  workspaceId: "wrk_1",
};

test("LLM settings workspace guard allows active workspace", () => {
  assert.doesNotThrow(() =>
    assertLlmSettingsWorkspace({
      context,
      targetWorkspaceId: "wrk_1",
    }),
  );
});

test("LLM settings workspace guard rejects cross-workspace save and clear", () => {
  assert.throws(
    () =>
      assertLlmSettingsWorkspace({
        context,
        targetWorkspaceId: "wrk_2",
      }),
    /llm_settings_workspace_mismatch/,
  );
});

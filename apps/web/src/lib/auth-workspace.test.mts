import assert from "node:assert/strict";
import test from "node:test";

import { assertWorkspaceAccess } from "./auth-workspace.ts";

test("assertWorkspaceAccess allows records in the active workspace", () => {
  assert.doesNotThrow(() =>
    assertWorkspaceAccess(
      { userId: "usr_1", workspaceId: "wrk_1", role: "admin" },
      "wrk_1",
    ),
  );
});

test("assertWorkspaceAccess rejects cross-workspace access", () => {
  assert.throws(
    () =>
      assertWorkspaceAccess(
        { userId: "usr_1", workspaceId: "wrk_1", role: "admin" },
        "wrk_2",
      ),
    /workspace_access_denied/,
  );
});

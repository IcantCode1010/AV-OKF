import assert from "node:assert/strict";
import test from "node:test";

import {
  createChatSession,
  getChatSessions,
  isChatAvailable,
  sendChatMessage,
} from "./chat-backend.ts";

test("chat is unavailable and every action rejects when not on the production backend", async () => {
  const previousBackend = process.env.AV_OKF_BACKEND;
  delete process.env.AV_OKF_BACKEND;

  try {
    assert.equal(isChatAvailable(), false);
    await assert.rejects(() => createChatSession(), /chat_requires_production_backend/);
    await assert.rejects(() => getChatSessions(), /chat_requires_production_backend/);
    await assert.rejects(
      () => sendChatMessage("session_1", "hello"),
      /chat_requires_production_backend/,
    );
  } finally {
    if (previousBackend === undefined) {
      delete process.env.AV_OKF_BACKEND;
    } else {
      process.env.AV_OKF_BACKEND = previousBackend;
    }
  }
});

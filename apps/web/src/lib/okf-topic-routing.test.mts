import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOkfTopicViewHref,
  normalizeOkfTopicReturnTo,
} from "./okf-topic-routing.ts";

test("topic return paths accept only one anchored chat-session segment", () => {
  assert.equal(normalizeOkfTopicReturnTo("/chat/cmr8njtlb000001mnh3t84b1v"), "/chat/cmr8njtlb000001mnh3t84b1v");
  assert.equal(normalizeOkfTopicReturnTo("/chat/session-with-hyphens"), "/chat/session-with-hyphens");

  for (const malicious of [
    "https://evil.example/chat/session",
    "//evil.example/chat/session",
    "/chat/session/extra",
    "/chat/session?next=https://evil.example",
    "/chat/session#fragment",
    "/chat/%2F%2Fevil.example",
    "/chat/session%2Fextra",
    "\\evil.example\\chat\\session",
    "",
  ]) {
    assert.equal(normalizeOkfTopicReturnTo(malicious), "/chat", malicious);
  }
});

test("topic href encodes bundle, file, and normalized return path", () => {
  assert.equal(
    buildOkfTopicViewHref({
      bundleId: "bundle-1",
      filePath: "concepts/system/main brakes.md",
      returnTo: "/chat/session-1",
    }),
    "/knowledge/bundle-1/topic?file=concepts%2Fsystem%2Fmain+brakes.md&returnTo=%2Fchat%2Fsession-1",
  );
  assert.match(
    buildOkfTopicViewHref({
      bundleId: "bundle-1",
      filePath: "concepts/system/main.md",
      returnTo: "https://evil.example",
    }),
    /returnTo=%2Fchat$/,
  );
});

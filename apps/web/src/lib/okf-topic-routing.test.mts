import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOkfTopicViewHref,
  normalizeOkfTopicFilePath,
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

test("topic file paths normalize safely for reads and exported path lookup", () => {
  assert.equal(
    normalizeOkfTopicFilePath("concepts//system\\brakes.md"),
    "concepts/system/brakes.md",
  );
  assert.equal(
    normalizeOkfTopicFilePath("concepts/system/%62rakes.md"),
    "concepts/system/brakes.md",
  );

  for (const unsafe of [
    "../outside.md",
    "concepts/../../outside.md",
    "%2e%2e%2foutside.md",
    "%252e%252e%252foutside.md",
    "/absolute/outside.md",
    "C:/outside.md",
    "//evil.example/topic.md",
    "concepts/system/not-markdown.txt",
  ]) {
    assert.equal(normalizeOkfTopicFilePath(unsafe), null, unsafe);
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

import assert from "node:assert/strict";
import test from "node:test";

import { parseCitationMarkers } from "./chat-citation-markers.ts";

test("parseCitationMarkers splits text around citation markers", () => {
  const segments = parseCitationMarkers(
    "The amber REV indication shows[1] with uncommanded reverse thrust[2].",
  );

  assert.deepEqual(segments, [
    { type: "text", value: "The amber REV indication shows" },
    { type: "citation", index: 1 },
    { type: "text", value: " with uncommanded reverse thrust" },
    { type: "citation", index: 2 },
    { type: "text", value: "." },
  ]);
});

test("parseCitationMarkers returns a single text segment when there are no markers", () => {
  const segments = parseCitationMarkers(
    "Chat routing isn't implemented yet - this is a placeholder reply.",
  );

  assert.deepEqual(segments, [
    {
      type: "text",
      value: "Chat routing isn't implemented yet - this is a placeholder reply.",
    },
  ]);
});

test("parseCitationMarkers handles a marker at the very start or end", () => {
  assert.deepEqual(parseCitationMarkers("[1] leads."), [
    { type: "citation", index: 1 },
    { type: "text", value: " leads." },
  ]);
  assert.deepEqual(parseCitationMarkers("Trailing citation[3]"), [
    { type: "text", value: "Trailing citation" },
    { type: "citation", index: 3 },
  ]);
});

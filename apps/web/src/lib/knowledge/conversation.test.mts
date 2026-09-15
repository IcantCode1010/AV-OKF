import test from "node:test";
import assert from "node:assert/strict";
import { conversationalReply } from "./conversation.ts";
test("greetings and acknowledgements need no retrieval", () => {
  assert.match(conversationalReply("Hi!")!, /Hi!/);
  assert.match(conversationalReply("Thank you")!, /welcome/);
});
test("a greeting attached to a technical question still requires research", () => {
  assert.equal(
    conversationalReply("Hi, how does the hydraulic system work?"),
    null,
  );
  assert.equal(
    conversationalReply("thanks, what pressure does BLUE use?"),
    null,
  );
});

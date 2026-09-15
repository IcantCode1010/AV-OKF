import assert from "node:assert/strict";
import test from "node:test";
import { ChatDeliveryFailure, chatSendSchema, createChatDeliveryStream, findRecoveredChatReply, readChatDelivery, type ChatDeliveryEvent } from "./chat-delivery.ts";
import type { ChatMessage } from "./chat-types.ts";

const user: ChatMessage = { id:"user", sessionId:"session", role:"user", content:"All bleed issues?", citations:[], createdAt:"2026-09-13T00:00:00Z", knowledgeBundleIds:["bundle"], scopeVersion:1, trace:null };
const assistant: ChatMessage = { ...user, id:"answer", role:"assistant", content:"A long validated answer. ".repeat(10000) };
const result = {userMessage:user, assistantMessage:assistant};

test("long answers arrive intact only after validation/persistence while progress is delivered earlier", async () => {
  let finish!: () => void;
  const wait = new Promise<void>(resolve => { finish = resolve; });
  const events: ChatDeliveryEvent[] = [];
  const response = new Response(createChatDeliveryStream(async progress => {
    progress("answering"); await wait; progress("validating"); progress("saving"); return result;
  }, 5));
  const read = readChatDelivery(response, event => events.push(event));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(events.some(event => event.type === "heartbeat"));
  assert.ok(events.some(event => event.type === "progress"));
  assert.ok(!events.some(event => event.type === "complete"));
  finish(); await read;
  assert.deepEqual(events.at(-1), {type:"complete", ...result});
  assert.deepEqual(events.filter(event => event.type === "progress").map(event => event.stage), ["searching","answering","validating","saving"]);
});

test("UTF-8 and NDJSON fragments across arbitrary byte boundaries preserve the final answer", async () => {
  const payload = new TextEncoder().encode(JSON.stringify({type:"complete", ...result, assistantMessage:{...assistant,content:"Pressurisation – système"}})+"\n");
  const stream = new ReadableStream<Uint8Array>({start(controller) { for (let i=0;i<payload.length;i+=7) controller.enqueue(payload.slice(i,i+7)); controller.close(); }});
  const events: ChatDeliveryEvent[] = [];
  await readChatDelivery(new Response(stream), event => events.push(event));
  assert.equal(events.length,1);
  assert.equal(events[0].type === "complete" && events[0].assistantMessage.content,"Pressurisation – système");
});

test("premature EOF, malformed events and wrong roles fail instead of silently losing an answer", async () => {
  for (const body of ['{"type":"heartbeat"}\n','{"type":"unknown"}\n','broken',JSON.stringify({type:"complete",userMessage:assistant,assistantMessage:user})]) {
    await assert.rejects(readChatDelivery(new Response(body),()=>{}));
  }
});

test("provider errors are generic and explicit, not partial model output or internal exceptions", async () => {
  const response = new Response(createChatDeliveryStream(async () => { throw new Error("private provider prompt and key"); }));
  await assert.rejects(readChatDelivery(response,()=>{}), error => error instanceof ChatDeliveryFailure && !error.message.includes("private"));
});

test("disconnect cleans delivery while already-started work can persist exactly once", async () => {
  let finish!: () => void, writes = 0;
  const waiting = new Promise<void>(resolve => { finish=resolve; });
  const stream = createChatDeliveryStream(async () => { await waiting; writes++; return result; },5);
  const reader=stream.getReader(); await reader.read(); await reader.cancel(); finish();
  await new Promise(resolve => setTimeout(resolve,15)); assert.equal(writes,1);
});

test("recovery matches a reply after the captured boundary, not a previous identical question", () => {
  const oldUser={...user,id:"old-user"},oldAnswer={...assistant,id:"old-answer"};
  assert.equal(findRecoveredChatReply([oldUser,oldAnswer],oldAnswer.id,user.content),undefined);
  assert.equal(findRecoveredChatReply([oldUser,oldAnswer,user,assistant],oldAnswer.id,user.content)?.id,assistant.id);
  assert.equal(findRecoveredChatReply([user,assistant],"missing",user.content),undefined);
  assert.equal(findRecoveredChatReply([user],null,user.content),undefined);
});

test("empty, excessive and invalid clarification requests are rejected", () => {
  for (const input of [{content:" "},{content:"a".repeat(16001)},{content:"hello",metadataSelection:[{field:42}]}]) assert.equal(chatSendSchema.safeParse(input).success,false);
  assert.equal(chatSendSchema.safeParse({content:"hello"}).success,true);
});

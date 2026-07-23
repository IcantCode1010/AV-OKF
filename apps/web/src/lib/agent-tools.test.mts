import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_TOOL_CALL_LIMIT,
  createAgentToolExecutor,
  createEvaluationAgentRuntime,
} from "./agent-tools.ts";

function executor(route: "okf_only" | "rag_only" | "missing_context" = "okf_only") {
  return createAgentToolExecutor({
    bundleIds: ["bundle-a"],
    mode: "deterministic",
    route,
    workspaceId: "workspace-a",
  });
}

test("bounded tools reject bundles outside the immutable scope", async () => {
  const tools = executor();
  await assert.rejects(
    tools.run({
      bundleIds: ["bundle-b"],
      execute: async () => ({ data: [] }),
      input: { query: "brakes" },
      tool: "searchOkf",
    }),
    /agent_tool_bundle_not_allowed/,
  );
  assert.equal(tools.trace().calls[0]?.status, "blocked");
});

test("missing-context routes cannot execute retrieval tools", async () => {
  const tools = executor("missing_context");
  await assert.rejects(
    tools.run({
      execute: async () => ({ data: [] }),
      input: { query: "what procedure" },
      tool: "searchOkf",
    }),
    /agent_tool_route_not_allowed/,
  );
});

test("OKF raw fallback requires an explicit qualified miss", async () => {
  const tools = executor();
  await assert.rejects(
    tools.run({
      execute: async () => ({ data: [] }),
      input: { query: "brakes" },
      tool: "searchRawRag",
    }),
    /agent_tool_raw_rag_fallback_not_allowed/,
  );
  const results = await tools.run({
    allowRawRagFallback: true,
    execute: async () => ({ data: ["raw"], resultCount: 1 }),
    input: { query: "brakes" },
    tool: "searchRawRag",
  });
  assert.deepEqual(results, ["raw"]);
});

test("tool execution stops at the per-turn call limit", async () => {
  const tools = executor("rag_only");
  for (let index = 0; index < AGENT_TOOL_CALL_LIMIT; index += 1) {
    await tools.run({
      execute: async () => ({ data: [] }),
      input: { query: `query-${index}` },
      tool: "searchRawRag",
    });
  }
  await assert.rejects(
    tools.run({
      execute: async () => ({ data: [] }),
      input: { query: "one-too-many" },
      tool: "searchRawRag",
    }),
    /agent_tool_call_limit_exceeded/,
  );
  assert.equal(tools.trace().calls.length, AGENT_TOOL_CALL_LIMIT + 1);
});

function createRuntime(route: "okf_only" | "rag_only" = "okf_only") {
  const calls: string[] = [];
  const runtime = createEvaluationAgentRuntime({
    context: {
      bundleIds: ["bundle-a"],
      route,
      workspaceId: "workspace-a",
    },
    handlers: {
      async followOkfRelation() {
        calls.push("follow");
        return [];
      },
      async readOkfFile() {
        calls.push("read-okf");
        return { body: "Approved procedure" };
      },
      async readSourcePages() {
        calls.push("read-pages");
        return [{ pageNumber: 7, text: "Source page" }];
      },
      async searchCoveredRag() {
        calls.push("covered-rag");
        return [];
      },
      async searchOkf() {
        calls.push("search-okf");
        return [{
          coveredRagChunkIds: ["chunk-1"],
          documentId: "document-1",
          filePath: "concepts/procedure.md",
          knowledgeBundleId: "bundle-a",
          sourcePageNumbers: [7],
        }];
      },
      async searchRawRag() {
        calls.push("search-raw");
        return [];
      },
      async validateAnswerEvidence() {
        calls.push("validate");
        return { supported: true };
      },
    },
  });
  return { calls, runtime };
}

async function executeTool(
  runtime: ReturnType<typeof createRuntime>["runtime"],
  name: keyof ReturnType<typeof createRuntime>["runtime"]["tools"],
  input: Record<string, unknown>,
) {
  const execute = runtime.tools[name]?.execute;
  assert.ok(execute);
  return execute(input as never, {
    abortSignal: new AbortController().signal,
    messages: [],
    toolCallId: `call-${String(name)}`,
  });
}

test("evaluation runtime permits only evidence discovered earlier in the turn", async () => {
  const { calls, runtime } = createRuntime();
  await assert.rejects(
    executeTool(runtime, "readOkfFile", {
      bundleId: "bundle-a",
      filePath: "concepts/procedure.md",
    }),
    /agent_tool_file_not_discovered/,
  );
  assert.equal(runtime.trace().calls[0]?.status, "blocked");

  await executeTool(runtime, "searchOkf", { query: "approved procedure" });
  await executeTool(runtime, "readOkfFile", {
    bundleId: "bundle-a",
    filePath: "concepts/procedure.md",
  });
  await executeTool(runtime, "searchCoveredRag", {
    bundleId: "bundle-a",
    chunkIds: ["chunk-1"],
  });
  await executeTool(runtime, "readSourcePages", {
    bundleId: "bundle-a",
    documentId: "document-1",
    pageNumbers: [7],
  });

  assert.deepEqual(calls, ["search-okf", "read-okf", "covered-rag", "read-pages"]);
});

test("rag-only evaluation cannot invoke OKF tools", async () => {
  const { runtime } = createRuntime("rag_only");
  await assert.rejects(
    executeTool(runtime, "searchOkf", { query: "procedure" }),
    /agent_tool_route_not_allowed/,
  );
  assert.equal(runtime.trace().calls[0]?.status, "blocked");
});

test("evaluation runtime reserves the eighth call for mandatory validation", async () => {
  const { calls, runtime } = createRuntime("rag_only");
  for (let index = 0; index < AGENT_TOOL_CALL_LIMIT - 1; index += 1) {
    await executeTool(runtime, "searchRawRag", { query: `query-${index}` });
  }
  await assert.rejects(
    executeTool(runtime, "searchRawRag", { query: "one-too-many" }),
    /agent_tool_validation_call_reserved/,
  );
  const validation = await runtime.validateAnswerEvidence("Answer [1]");
  assert.deepEqual(validation, { supported: true });
  assert.equal(calls.at(-1), "validate");
  assert.equal(runtime.trace().calls.at(-1)?.tool, "validateAnswerEvidence");
});

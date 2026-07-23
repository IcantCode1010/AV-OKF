import { tool, type ToolSet } from "ai";
import { z } from "zod";

import type { ChatRoute } from "./chat-router.ts";

export const AGENT_TOOL_CALL_LIMIT = 8;
export const AGENT_GRAPH_HOP_LIMIT = 2;
export const AGENT_SOURCE_PAGE_LIMIT = 5;

export const agentToolNames = [
  "searchOkf",
  "readOkfFile",
  "followOkfRelation",
  "searchCoveredRag",
  "searchRawRag",
  "readSourcePages",
  "validateAnswerEvidence",
] as const;

export type AgentToolName = (typeof agentToolNames)[number];
export type AgentExecutionMode = "deterministic" | "model_evaluation";
export type AgentToolStatus = "succeeded" | "failed" | "blocked";

export type AgentToolExecutionTrace = {
  sequence: number;
  tool: AgentToolName;
  status: AgentToolStatus;
  bundleIds: string[];
  input: Record<string, unknown>;
  resultCount: number;
  warningCodes: string[];
  errorCode?: string;
};

export type AgentExecutionTrace = {
  mode: AgentExecutionMode;
  callLimit: number;
  calls: AgentToolExecutionTrace[];
};

export type AgentToolContext = Readonly<{
  workspaceId: string;
  bundleIds: readonly string[];
  route: ChatRoute;
  mode: AgentExecutionMode;
}>;

export type AgentToolResult<T> = {
  data: T;
  resultCount?: number;
  warningCodes?: string[];
};

type AgentToolRunInput<T> = {
  tool: AgentToolName;
  bundleIds?: string[];
  input: Record<string, unknown>;
  allowRawRagFallback?: boolean;
  policyErrorCode?: string;
  execute(): Promise<AgentToolResult<T>>;
};

export function createAgentToolExecutor(context: AgentToolContext) {
  const allowedBundleIds = new Set(context.bundleIds);
  const calls: AgentToolExecutionTrace[] = [];

  async function run<T>(input: AgentToolRunInput<T>): Promise<T> {
    const bundleIds = input.bundleIds ?? [...context.bundleIds];
    const sequence = calls.length + 1;
    const blockedCode =
      getPolicyBlockCode({
        allowedBundleIds,
        allowRawRagFallback: input.allowRawRagFallback === true,
        bundleIds,
        callCount: calls.filter((call) => call.status !== "blocked").length,
        mode: context.mode,
        route: context.route,
        tool: input.tool,
      }) ?? input.policyErrorCode;

    if (blockedCode) {
      calls.push({
        bundleIds,
        errorCode: blockedCode,
        input: sanitizeToolInput(input.input),
        resultCount: 0,
        sequence,
        status: "blocked",
        tool: input.tool,
        warningCodes: [],
      });
      throw new Error(blockedCode);
    }

    try {
      const result = await input.execute();
      calls.push({
        bundleIds,
        input: sanitizeToolInput(input.input),
        resultCount: result.resultCount ?? countResult(result.data),
        sequence,
        status: "succeeded",
        tool: input.tool,
        warningCodes: result.warningCodes ?? [],
      });
      return result.data;
    } catch (error) {
      const errorCode = error instanceof Error ? error.message : "agent_tool_failed";
      calls.push({
        bundleIds,
        errorCode,
        input: sanitizeToolInput(input.input),
        resultCount: 0,
        sequence,
        status: "failed",
        tool: input.tool,
        warningCodes: [],
      });
      throw error;
    }
  }

  return {
    context,
    run,
    trace(): AgentExecutionTrace {
      return {
        callLimit: AGENT_TOOL_CALL_LIMIT,
        calls: calls.map((call) => ({ ...call })),
        mode: context.mode,
      };
    },
  };
}

const searchOkfInput = z.object({ query: z.string().trim().min(1).max(2_000) });
const readOkfFileInput = z.object({
  bundleId: z.string().trim().min(1),
  filePath: z.string().trim().min(1).max(1_000),
});
const followOkfRelationInput = z.object({
  bundleId: z.string().trim().min(1),
  seedFiles: z.array(z.string().trim().min(1).max(1_000)).min(1).max(4),
  maxHops: z.number().int().min(1).max(AGENT_GRAPH_HOP_LIMIT).default(2),
});
const searchCoveredRagInput = z.object({
  bundleId: z.string().trim().min(1),
  chunkIds: z.array(z.string().trim().min(1)).min(1).max(50),
});
const searchRawRagInput = z.object({ query: z.string().trim().min(1).max(2_000) });
const readSourcePagesInput = z.object({
  bundleId: z.string().trim().min(1),
  documentId: z.string().trim().min(1),
  pageNumbers: z.array(z.number().int().positive()).min(1).max(AGENT_SOURCE_PAGE_LIMIT),
});
const validateAnswerEvidenceInput = z.object({
  answer: z.string().trim().min(1).max(20_000),
});

export type AgentEvaluationHandlers = {
  searchOkf(input: z.infer<typeof searchOkfInput>): Promise<unknown>;
  readOkfFile(input: z.infer<typeof readOkfFileInput>): Promise<unknown>;
  followOkfRelation(input: z.infer<typeof followOkfRelationInput>): Promise<unknown>;
  searchCoveredRag(input: z.infer<typeof searchCoveredRagInput>): Promise<unknown>;
  searchRawRag(input: z.infer<typeof searchRawRagInput>): Promise<unknown>;
  readSourcePages(input: z.infer<typeof readSourcePagesInput>): Promise<unknown>;
  validateAnswerEvidence(
    input: z.infer<typeof validateAnswerEvidenceInput>,
  ): Promise<unknown>;
};

export type AgentEvaluationRuntime = {
  tools: ToolSet;
  trace(): AgentExecutionTrace;
  validateAnswerEvidence(answer: string): Promise<unknown>;
};

export function createEvaluationAgentRuntime(input: {
  context: Omit<AgentToolContext, "mode">;
  handlers: AgentEvaluationHandlers;
}): AgentEvaluationRuntime {
  const executor = createAgentToolExecutor({
    ...input.context,
    mode: "model_evaluation",
  });
  const discoveredFiles = new Map<string, Set<string>>();
  const discoveredChunkIds = new Set<string>();
  const discoveredPages = new Map<string, Set<number>>();
  let qualifiedOkfMissObserved = false;

  const run = async <T>(options: {
    bundleIds?: string[];
    input: Record<string, unknown>;
    tool: AgentToolName;
    allowRawRagFallback?: boolean;
    policyErrorCode?: string;
    execute(): Promise<T>;
  }) =>
    executor.run({
      ...options,
      execute: async () => {
        const data = await options.execute();
        return { data, resultCount: countResult(data) };
      },
    });

  const tools: ToolSet = {
    searchOkf: tool({
      description: "Search approved active OKF concepts in the allowed knowledge scope.",
      inputSchema: searchOkfInput,
      execute: async (toolInput) => {
        const result = await run({
          input: toolInput,
          tool: "searchOkf",
          execute: () => input.handlers.searchOkf(toolInput),
        });
        qualifiedOkfMissObserved = countResult(result) === 0;
        collectDiscoveredEvidence(result, {
          chunkIds: discoveredChunkIds,
          files: discoveredFiles,
          pages: discoveredPages,
        });
        return result;
      },
    }),
    readOkfFile: tool({
      description: "Read one approved OKF concept already discovered in this turn.",
      inputSchema: readOkfFileInput,
      execute: async (toolInput) => {
        return run({
          bundleIds: [toolInput.bundleId],
          input: toolInput,
          policyErrorCode: isDiscoveredFile(
            discoveredFiles,
            toolInput.bundleId,
            toolInput.filePath,
          )
            ? undefined
            : "agent_tool_file_not_discovered",
          tool: "readOkfFile",
          execute: () => input.handlers.readOkfFile(toolInput),
        });
      },
    }),
    followOkfRelation: tool({
      description: "Follow approved typed relations inside one knowledge bundle.",
      inputSchema: followOkfRelationInput,
      execute: async (toolInput) => {
        const result = await run({
          bundleIds: [toolInput.bundleId],
          input: toolInput,
          policyErrorCode: toolInput.seedFiles.every((filePath) =>
            isDiscoveredFile(discoveredFiles, toolInput.bundleId, filePath),
          )
            ? undefined
            : "agent_tool_file_not_discovered",
          tool: "followOkfRelation",
          execute: () => input.handlers.followOkfRelation(toolInput),
        });
        collectDiscoveredEvidence(result, {
          chunkIds: discoveredChunkIds,
          files: discoveredFiles,
          pages: discoveredPages,
        });
        return result;
      },
    }),
    searchCoveredRag: tool({
      description: "Read raw chunks explicitly coverage-linked to discovered OKF concepts.",
      inputSchema: searchCoveredRagInput,
      execute: async (toolInput) => {
        const result = await run({
          bundleIds: [toolInput.bundleId],
          input: toolInput,
          policyErrorCode: toolInput.chunkIds.every((chunkId) =>
            discoveredChunkIds.has(chunkId),
          )
            ? undefined
            : "agent_tool_chunk_not_discovered",
          tool: "searchCoveredRag",
          execute: () => input.handlers.searchCoveredRag(toolInput),
        });
        collectDiscoveredEvidence(result, {
          chunkIds: discoveredChunkIds,
          files: discoveredFiles,
          pages: discoveredPages,
        });
        return result;
      },
    }),
    searchRawRag: tool({
      description: "Search unreviewed raw document chunks in the allowed knowledge scope.",
      inputSchema: searchRawRagInput,
      execute: async (toolInput) => {
        const result = await run({
          allowRawRagFallback: qualifiedOkfMissObserved,
          input: toolInput,
          tool: "searchRawRag",
          execute: () => input.handlers.searchRawRag(toolInput),
        });
        collectDiscoveredEvidence(result, {
          chunkIds: discoveredChunkIds,
          files: discoveredFiles,
          pages: discoveredPages,
        });
        return result;
      },
    }),
    readSourcePages: tool({
      description: "Read up to five source pages already referenced by evidence.",
      inputSchema: readSourcePagesInput,
      execute: async (toolInput) => {
        const allowedPages = discoveredPages.get(toolInput.documentId);
        return run({
          bundleIds: [toolInput.bundleId],
          input: toolInput,
          policyErrorCode:
            allowedPages &&
            toolInput.pageNumbers.every((pageNumber) => allowedPages.has(pageNumber))
              ? undefined
              : "agent_tool_page_not_discovered",
          tool: "readSourcePages",
          execute: () => input.handlers.readSourcePages(toolInput),
        });
      },
    }),
  };

  return {
    tools,
    trace: executor.trace,
    validateAnswerEvidence(answer: string) {
      const toolInput = validateAnswerEvidenceInput.parse({ answer });
      return run({
        input: toolInput,
        tool: "validateAnswerEvidence",
        execute: () => input.handlers.validateAnswerEvidence(toolInput),
      });
    },
  };
}

function getPolicyBlockCode(input: {
  allowedBundleIds: Set<string>;
  allowRawRagFallback: boolean;
  bundleIds: string[];
  callCount: number;
  mode: AgentExecutionMode;
  route: ChatRoute;
  tool: AgentToolName;
}): string | null {
  if (input.callCount >= AGENT_TOOL_CALL_LIMIT) return "agent_tool_call_limit_exceeded";
  if (
    input.mode === "model_evaluation" &&
    input.tool !== "validateAnswerEvidence" &&
    input.callCount >= AGENT_TOOL_CALL_LIMIT - 1
  ) {
    return "agent_tool_validation_call_reserved";
  }
  if (input.bundleIds.some((id) => !input.allowedBundleIds.has(id))) {
    return "agent_tool_bundle_not_allowed";
  }
  if (input.route === "unsupported" || input.route === "missing_context") {
    return "agent_tool_route_not_allowed";
  }
  if (
    input.route === "rag_only" &&
    (
      input.tool === "searchOkf" ||
      input.tool === "readOkfFile" ||
      input.tool === "followOkfRelation" ||
      input.tool === "searchCoveredRag"
    )
  ) {
    return "agent_tool_route_not_allowed";
  }
  if (
    input.tool === "searchRawRag" &&
    input.route === "okf_only" &&
    !input.allowRawRagFallback
  ) {
    return "agent_tool_raw_rag_fallback_not_allowed";
  }
  return null;
}

function sanitizeToolInput(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [
      key,
      key === "answer" && typeof value === "string"
        ? `${value.slice(0, 500)}${value.length > 500 ? "..." : ""}`
        : value,
    ]),
  );
}

function countResult(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object" && "results" in value) {
    const results = (value as { results?: unknown }).results;
    return Array.isArray(results) ? results.length : 1;
  }
  return value == null ? 0 : 1;
}

function isDiscoveredFile(
  files: Map<string, Set<string>>,
  bundleId: string,
  filePath: string,
): boolean {
  return files.get(bundleId)?.has(filePath) === true;
}

function collectDiscoveredEvidence(
  value: unknown,
  state: {
    chunkIds: Set<string>;
    files: Map<string, Set<string>>;
    pages: Map<string, Set<number>>;
  },
) {
  const visit = (candidate: unknown) => {
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    if (!candidate || typeof candidate !== "object") return;
    const record = candidate as Record<string, unknown>;
    const bundleId =
      typeof record.knowledgeBundleId === "string"
        ? record.knowledgeBundleId
        : typeof record.bundleId === "string"
          ? record.bundleId
          : null;
    const filePath =
      typeof record.filePath === "string"
        ? record.filePath
        : typeof record.okfFilePath === "string"
          ? record.okfFilePath
          : null;
    if (bundleId && filePath) {
      const files = state.files.get(bundleId) ?? new Set<string>();
      files.add(filePath);
      state.files.set(bundleId, files);
    }
    if (typeof record.chunkId === "string") state.chunkIds.add(record.chunkId);
    if (Array.isArray(record.coveredRagChunkIds)) {
      record.coveredRagChunkIds.forEach((chunkId) => {
        if (typeof chunkId === "string") state.chunkIds.add(chunkId);
      });
    }
    if (typeof record.documentId === "string") {
      const pages = state.pages.get(record.documentId) ?? new Set<number>();
      if (Array.isArray(record.sourcePageNumbers)) {
        record.sourcePageNumbers.forEach((page) => {
          if (typeof page === "number" && Number.isInteger(page) && page > 0) {
            pages.add(page);
          }
        });
      }
      if (
        typeof record.pageStart === "number" &&
        typeof record.pageEnd === "number"
      ) {
        for (
          let page = record.pageStart;
          page <= record.pageEnd && pages.size < AGENT_SOURCE_PAGE_LIMIT;
          page += 1
        ) {
          if (Number.isInteger(page) && page > 0) pages.add(page);
        }
      }
      state.pages.set(record.documentId, pages);
    }
    Object.values(record).forEach((nested) => {
      if (nested !== record) visit(nested);
    });
  };

  visit(value);
}

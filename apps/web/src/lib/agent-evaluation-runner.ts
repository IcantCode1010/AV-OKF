import {
  generateText,
  stepCountIs,
  type LanguageModel,
} from "ai";

import {
  AGENT_TOOL_CALL_LIMIT,
  type AgentEvaluationRuntime,
  type AgentExecutionTrace,
} from "./agent-tools.ts";
import type { ChatRouterDecision } from "./chat-router.ts";

export type AgentEvaluationResult = {
  answer: string;
  stepCount: number;
  toolCallCount: number;
  toolNames: string[];
  trace: AgentExecutionTrace;
  validation: unknown;
};

export async function runBoundedAgentToolEvaluation(input: {
  decision: ChatRouterDecision;
  model: LanguageModel;
  query: string;
  runtime: AgentEvaluationRuntime;
}): Promise<AgentEvaluationResult> {
  if (
    input.decision.route === "missing_context" ||
    input.decision.route === "unsupported"
  ) {
    return {
      answer: "",
      stepCount: 0,
      toolCallCount: 0,
      toolNames: [],
      trace: {
        callLimit: AGENT_TOOL_CALL_LIMIT,
        calls: [],
        mode: "model_evaluation",
      },
      validation: null,
    };
  }

  const result = await generateText({
    model: input.model,
    prompt: [
      `Question: ${input.query}`,
      `Authoritative route: ${input.decision.route}`,
      "Use only the provided read-only tools.",
      "Do not change the route or treat raw RAG as approved knowledge.",
      "Use the smallest number of calls needed and stop when the evidence is sufficient.",
      "Return a concise evidence-grounded answer. The application will independently validate it.",
    ].join("\n"),
    stopWhen: stepCountIs(AGENT_TOOL_CALL_LIMIT - 1),
    tools: input.runtime.tools,
  });
  const toolCalls = result.steps.flatMap((step) => step.toolCalls);
  const validation = await input.runtime.validateAnswerEvidence(result.text);
  return {
    answer: result.text,
    stepCount: result.steps.length,
    toolCallCount: toolCalls.length,
    toolNames: toolCalls.map((call) => call.toolName),
    trace: input.runtime.trace(),
    validation,
  };
}

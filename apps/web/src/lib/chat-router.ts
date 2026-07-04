export type ChatRoute =
  | "okf_only"
  | "rag_only"
  | "hybrid"
  | "missing_context"
  | "unsupported";

export type ChatQueryCategory =
  | "canonical_definition"
  | "policy_or_process"
  | "source_lookup"
  | "open_ended_discovery"
  | "cross_document_summary"
  | "comparison"
  | "high_risk_domain"
  | "live_or_fresh_data"
  | "missing_context"
  | "unsupported";

export type ChatRouterConfidence = "high" | "medium" | "low";

export type ChatRouterDecision = {
  confidence: ChatRouterConfidence;
  constraints: {
    approvedOnly: boolean;
    includeUnreviewed: boolean;
  };
  queryCategory: ChatQueryCategory;
  rationale: string;
  requiredContext: string[];
  route: ChatRoute;
};

export type Stage6aRouterTrace = ChatRouterDecision & {
  retrievalToolsCalled: string[];
  sourcesRead: string[];
  stage: "router";
};

const MISSING_OPERATIONAL_CONTEXT = [
  "aircraft_family",
  "effectivity",
  "source_authority",
  "operational_context",
];

export function routeChatQuestion(question: string): ChatRouterDecision {
  const normalized = normalizeQuestion(question);

  if (matchesAny(normalized, LIVE_OR_EXTERNAL_PATTERNS)) {
    return {
      confidence: "high",
      constraints: { approvedOnly: false, includeUnreviewed: false },
      queryCategory: "live_or_fresh_data",
      rationale:
        "The question asks for live or external data that static uploaded documents cannot supply.",
      requiredContext: [],
      route: "unsupported",
    };
  }

  if (matchesAny(normalized, MISSING_CONTEXT_PATTERNS)) {
    return {
      confidence: "high",
      constraints: { approvedOnly: true, includeUnreviewed: false },
      queryCategory: "missing_context",
      rationale:
        "The question asks for an operational decision without enough aircraft, source, or situation context.",
      requiredContext: MISSING_OPERATIONAL_CONTEXT,
      route: "missing_context",
    };
  }

  if (matchesAny(normalized, HYBRID_PATTERNS)) {
    return {
      confidence: "medium",
      constraints: { approvedOnly: false, includeUnreviewed: true },
      queryCategory: "comparison",
      rationale:
        "The question asks for an approved answer plus supporting examples or raw source evidence.",
      requiredContext: [],
      route: "hybrid",
    };
  }

  if (matchesAny(normalized, RAG_PATTERNS)) {
    return {
      confidence: "high",
      constraints: { approvedOnly: false, includeUnreviewed: true },
      queryCategory: "open_ended_discovery",
      rationale:
        "The question asks for broad discovery across uploaded document text rather than a single approved concept.",
      requiredContext: [],
      route: "rag_only",
    };
  }

  if (matchesAny(normalized, OKF_PATTERNS)) {
    return {
      confidence: "high",
      constraints: { approvedOnly: true, includeUnreviewed: false },
      queryCategory: inferOkfCategory(normalized),
      rationale:
        "The question asks for stable, official, or reviewed knowledge that should come from approved OKF content.",
      requiredContext: [],
      route: "okf_only",
    };
  }

  return {
    confidence: "low",
    constraints: { approvedOnly: false, includeUnreviewed: false },
    queryCategory: "missing_context",
    rationale:
      "The question does not provide enough signal for a confident OKF, RAG, or hybrid route.",
    requiredContext: ["question_intent"],
    route: "missing_context",
  };
}

export function buildStage6aRouterTrace(
  decision: ChatRouterDecision,
): Stage6aRouterTrace {
  return {
    ...decision,
    retrievalToolsCalled: [],
    sourcesRead: [],
    stage: "router",
  };
}

export function buildStage6aRouterReply(decision: ChatRouterDecision): string {
  if (decision.route === "okf_only") {
    return "This looks like an approved-knowledge question. Retrieval will be added in the next Stage 6 slice.";
  }

  if (decision.route === "rag_only") {
    return "This looks like a broad document-search question. Retrieval will be added in the next Stage 6 slice.";
  }

  if (decision.route === "hybrid") {
    return "This needs both approved knowledge and raw supporting evidence. Hybrid retrieval will be added in the next Stage 6 slice.";
  }

  if (decision.route === "unsupported") {
    return "I cannot answer that from static uploaded documents alone. This question needs live data or an external system that is not connected yet.";
  }

  return [
    "I need a little more context before routing this safely.",
    `Please provide: ${formatRequiredContext(decision.requiredContext)}.`,
  ].join(" ");
}

function inferOkfCategory(normalized: string): ChatQueryCategory {
  if (/\b(manual path|source|authority|authoritative)\b/.test(normalized)) {
    return "source_lookup";
  }

  if (/\b(policy|process|procedure)\b/.test(normalized)) {
    return "policy_or_process";
  }

  return "canonical_definition";
}

function formatRequiredContext(requiredContext: string[]): string {
  return requiredContext
    .map((item) => item.replaceAll("_", " "))
    .join(", ");
}

function normalizeQuestion(question: string): string {
  return question.trim().toLowerCase().replace(/\s+/g, " ");
}

function matchesAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

const LIVE_OR_EXTERNAL_PATTERNS = [
  /\btoday'?s\b/,
  /\bcurrent\b/,
  /\bright now\b/,
  /\blive\b/,
  /\binventory count\b/,
  /\bweather\b/,
  /\bstock price\b/,
];

const MISSING_CONTEXT_PATTERNS = [
  /^can we dispatch\??$/,
  /^can i dispatch\??$/,
  /\bcan we dispatch\b/,
  /\bshould i\b/,
  /\bshould we\b/,
  /^what procedure should i use\??$/,
  /^which procedure should i use\??$/,
];

const HYBRID_PATTERNS = [
  /\b(approved|official|authoritative)\b.*\b(example|examples|supporting|raw|manuals|documents)\b/,
  /\b(example|examples|supporting|raw|manuals|documents)\b.*\b(approved|official|authoritative)\b/,
];

const RAG_PATTERNS = [
  /\bfind all\b/,
  /\bsearch\b/,
  /\bmentions?\b/,
  /\bsummarize\b/,
  /\bcompare\b/,
  /\bsimilar\b/,
  /\bseen this before\b/,
  /\bevery document\b/,
  /\bacross (the )?documents\b/,
];

const OKF_PATTERNS = [
  /\bofficial\b/,
  /\bapproved\b/,
  /\bdefinition\b/,
  /\bdefine\b/,
  /\bpolicy\b/,
  /\bprocess\b/,
  /\bprocedure\b/,
  /\bsource authority\b/,
  /\bauthoritative\b/,
  /\bmanual path\b/,
];

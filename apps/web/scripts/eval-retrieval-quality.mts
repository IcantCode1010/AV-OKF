import { retrieveDocuments } from "../src/lib/rag-backend.ts";
import { rerankRawRagCandidates } from "../src/lib/rag-reranker.ts";
import { readFile, writeFile } from "node:fs/promises";

if (process.argv[2] === "routes") {
  const { runRouteCoverageEval } = await import("./route-coverage-eval.mts");
  await runRouteCoverageEval({
    baselinePath: process.env.EVAL_BASELINE_PATH,
    outputPath: process.env.EVAL_OUTPUT_PATH,
    phase: process.argv[3] ?? "current",
  });
} else {
  await runRawRetrievalEval();
}

async function runRawRetrievalEval() {
const WORKSPACE_ID = process.env.EVAL_WORKSPACE_ID ?? "cmr2lf3s0000101suuz8cz5mn";
const BUNDLE_ID = process.env.EVAL_BUNDLE_ID ?? "cmrmlfnpe009601pcgkqi5pu2";
const EXPECTED_DOCUMENT = "03 Electrical Power";
const PHASE = process.argv[2] ?? "current";

const questions = [
  {
    id: "idg-normal-source",
    query: "What is the normal source of AC electrical power in flight?",
    expectedTerms: ["integrated drive generator", "idg"],
  },
  {
    id: "transfer-bus-off",
    query: "What does the TRANSFER BUS OFF light indicate?",
    expectedTerms: ["transfer bus off", "transfer bus"],
  },
  {
    id: "load-shedding",
    query: "Under what conditions does electrical load shedding occur?",
    expectedTerms: ["load shed", "load shedding"],
  },
  {
    id: "start-converter-unit",
    query: "What does the start converter unit do for the APU?",
    expectedTerms: ["start converter unit", "scu"],
  },
  {
    id: "static-inverter",
    query: "What is the purpose of the static inverter?",
    expectedTerms: ["static inverter", "standby bus"],
  },
] as const;

const results = [];
for (const question of questions) {
  const candidates = await retrieveDocuments({
    filters: { sourceTypes: ["raw_extraction"] },
    knowledgeBundleId: BUNDLE_ID,
    mode: "hybrid",
    query: question.query,
    topK: 10,
    workspaceId: WORKSPACE_ID,
  });
  const reranked = await rerankRawRagCandidates({
    candidates,
    query: question.query,
    workspaceId: WORKSPACE_ID,
  });
  const citations = reranked.results.slice(0, 6);
  const correct = citations.filter((citation) => {
    const text = citation.text.toLowerCase();
    return citation.documentTitle === EXPECTED_DOCUMENT &&
      question.expectedTerms.some((term) => text.includes(term));
  });
  results.push({
    citations: citations.map((citation) => ({
      chunkId: citation.chunkId,
      documentTitle: citation.documentTitle,
      pageEnd: citation.pageEnd,
      pageStart: citation.pageStart,
      text: citation.text.replace(/\s+/g, " ").slice(0, 240),
    })),
    correctCitationCount: correct.length,
    hit: correct.length > 0,
    id: question.id,
    query: question.query,
    rerank: reranked.trace,
  });
}

const baseline = process.env.EVAL_BASELINE_PATH
  ? JSON.parse(await readFile(process.env.EVAL_BASELINE_PATH, "utf8")) as {
      correctCitationCount: number;
      hitCount: number;
    }
  : null;
const correctCitationCount = results.reduce(
  (sum, result) => sum + result.correctCitationCount,
  0,
);
const hitCount = results.filter((result) => result.hit).length;
const report = {
  baselineComparison: baseline
    ? {
        baselineCorrectCitationCount: baseline.correctCitationCount,
        baselineHitCount: baseline.hitCount,
        correctCitationDelta: correctCitationCount - baseline.correctCitationCount,
        hitDelta: hitCount - baseline.hitCount,
        regressed: correctCitationCount < baseline.correctCitationCount,
      }
    : null,
  bundleId: BUNDLE_ID,
  correctCitationCount,
  evaluatedAt: new Date().toISOString(),
  hitCount,
  phase: PHASE,
  questions: results,
  workspaceId: WORKSPACE_ID,
};

console.log(`RETRIEVAL_EVAL_JSON=${JSON.stringify(report)}`);
if (process.env.EVAL_OUTPUT_PATH) {
  await writeFile(process.env.EVAL_OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}
if (
  report.hitCount !== questions.length ||
  report.baselineComparison?.regressed
) {
  process.exitCode = 1;
}
}

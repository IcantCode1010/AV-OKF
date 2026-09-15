import { createHash } from "node:crypto";

import { readOkfBundleFile } from "../src/lib/okf-bundle.ts";
import { getFrontmatterScalar, parseOkfMarkdown } from "../src/lib/okf-frontmatter.ts";
import { getKnowledgeBundleByIdentity, resolveKnowledgeBundleRoot } from "../src/lib/knowledge-bundles.ts";
import {
  buildRelationVerifierConcept,
  OkfRelationVerifierError,
  verifyOkfRelationCandidate,
} from "../src/lib/okf-relation-verifier.ts";

const workspaceId = requiredEnv("RELATION_VERIFIER_WORKSPACE_ID");
const bundleId = requiredEnv("RELATION_VERIFIER_BUNDLE_ID");
const sourceFile = requiredEnv("RELATION_VERIFIER_SOURCE_FILE");
const targetFile = requiredEnv("RELATION_VERIFIER_TARGET_FILE");
const proposedRelation = process.env.RELATION_VERIFIER_PROPOSED_RELATION?.trim() || "references";
const expected = process.env.RELATION_VERIFIER_EXPECT?.trim() || "negative";
const bundle = await getKnowledgeBundleByIdentity({ bundleId, workspaceId });
if (!bundle || bundle.status !== "active") throw new Error("knowledge_bundle_not_found");
if (!bundle.profile.relations.includes(proposedRelation)) throw new Error("relation_type_not_allowed");
const root = resolveKnowledgeBundleRoot({ bundleId, workspaceId });
const [source, target] = await Promise.all([
  loadConcept(root, sourceFile),
  loadConcept(root, targetFile),
]);

let outcome: "confirmed" | "filtered" | "application_rejected";
let diagnostic: string | null = null;
let provider: string | null = null;
let model: string | null = null;
try {
  const result = await verifyOkfRelationCandidate({
    allowedRelations: bundle.profile.relations,
    proposedRelation,
    proposedSource: source,
    proposedTarget: target,
    signals: ["configured_provider_probe"],
    workspaceId,
  });
  provider = result.provider;
  model = result.model;
  outcome = result.decision.related ? "confirmed" : "filtered";
} catch (error) {
  if (!(error instanceof OkfRelationVerifierError)) throw error;
  outcome = "application_rejected";
  diagnostic = error.message;
  provider = error.audit.provider ?? null;
  model = error.audit.model ?? null;
}

const passed = expected === "negative"
  ? outcome !== "confirmed"
  : outcome === "confirmed";
process.stdout.write(`${JSON.stringify({
  bundleId,
  diagnostic,
  expected,
  model,
  outcome,
  pairHash: createHash("sha256").update(`${sourceFile}\0${targetFile}\0${proposedRelation}`).digest("hex"),
  passed,
  provider,
}, null, 2)}\n`);
if (!passed) process.exitCode = 1;

async function loadConcept(root: string, filePath: string) {
  const file = await readOkfBundleFile(root, filePath);
  const parsed = parseOkfMarkdown(file.content);
  return buildRelationVerifierConcept({
    body: parsed.body,
    description: getFrontmatterScalar(parsed.frontmatter, "description"),
    filePath,
    title: getFrontmatterScalar(parsed.frontmatter, "title"),
  });
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

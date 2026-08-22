import { getFrontmatterScalar, parseOkfMarkdown } from "./okf-frontmatter.ts";
import { getKnowledgeBundleByIdentity, resolveKnowledgeBundleRoot } from "./knowledge-bundles.ts";
import { readOkfBundleFile } from "./okf-bundle.ts";
import { buildRelationVerifierConcept, canonicalizeRelationEvidenceText } from "./okf-relation-verifier.ts";
import { getPrisma } from "./prisma.ts";

export async function loadOkfRelationVerifierContext(input: {
  candidate: {
    evidenceChunkIds: string[];
    evidenceSourceQuote: string | null;
    knowledgeBundleId: string;
    sourceFile: string;
    targetAnchor: string | null;
    targetFile: string;
    targetResolution: string | null;
    workspaceId: string;
  };
}) {
  const candidate = input.candidate;
  const bundle = await getKnowledgeBundleByIdentity({
    bundleId: candidate.knowledgeBundleId,
    workspaceId: candidate.workspaceId,
  });
  if (!bundle || bundle.status !== "active") throw new Error("knowledge_bundle_not_found");
  const root = resolveKnowledgeBundleRoot({ bundleId: bundle.id, workspaceId: candidate.workspaceId });
  const [sourceFile, targetFile] = await Promise.all([
    readOkfBundleFile(root, candidate.sourceFile),
    readOkfBundleFile(root, candidate.targetFile),
  ]);
  const sourceParsed = parseOkfMarkdown(sourceFile.content);
  const targetParsed = parseOkfMarkdown(targetFile.content);
  let evidenceText = "";
  if (candidate.evidenceChunkIds.length > 0) {
    const sourceTopic = await getPrisma().topicRecord.findFirst({
      select: { documentId: true },
      where: {
        exportedFilePath: candidate.sourceFile,
        knowledgeBundleId: candidate.knowledgeBundleId,
        reviewStatus: "approved",
        workspaceId: candidate.workspaceId,
      },
    });
    if (!sourceTopic) throw new Error("relation_source_topic_not_found");
    const chunks = await getPrisma().ragChunk.findMany({
      orderBy: [{ pageStart: "asc" }, { chunkOrdinal: "asc" }],
      select: { text: true },
      where: {
        documentId: sourceTopic.documentId,
        id: { in: candidate.evidenceChunkIds },
        isActive: true,
        workspaceId: candidate.workspaceId,
      },
    });
    if (chunks.length !== new Set(candidate.evidenceChunkIds).size) {
      throw new Error("relation_evidence_chunks_stale");
    }
    evidenceText = chunks.map((chunk) => chunk.text).join("\n");
    if (candidate.evidenceSourceQuote && !canonicalizeRelationEvidenceText(evidenceText).includes(canonicalizeRelationEvidenceText(candidate.evidenceSourceQuote))) {
      throw new Error("relation_evidence_quote_stale");
    }
  }
  return {
    bundle,
    root,
    source: buildRelationVerifierConcept({
      body: [sourceParsed.body, evidenceText].filter(Boolean).join("\n"),
      description: getFrontmatterScalar(sourceParsed.frontmatter, "description"),
      filePath: candidate.sourceFile,
      title: getFrontmatterScalar(sourceParsed.frontmatter, "title"),
    }),
    target: buildRelationVerifierConcept({
      body: targetParsed.body,
      description: getFrontmatterScalar(targetParsed.frontmatter, "description"),
      filePath: candidate.targetFile,
      title: getFrontmatterScalar(targetParsed.frontmatter, "title"),
    }),
    targetAnchors: candidate.targetResolution === "unique_anchor" && candidate.targetAnchor
      ? [candidate.targetAnchor]
      : [],
  };
}

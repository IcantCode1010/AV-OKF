import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { traverseOkfRelations } from "../src/lib/okf-graph-retriever.ts";
import { publishedGraphResult } from "../src/lib/knowledge/published-graph-result.ts";
import { normalizeOkfConceptLifecycleStatus } from "../src/lib/okf-lifecycle.ts";

type Topic = { id: string; title: string; workspaceId: string; knowledgeBundleId: string; documentId: string;
  sourcePageNumbers: number[]; exportedFilePath: string; markdown: string };
const snapshot = JSON.parse((await readFile(process.argv[2], "utf8")).replace(/^\uFEFF/, "")) as { topics: Topic[] };
if (!snapshot.topics.length) throw Error("empty_published_snapshot");
const lifecycle = process.argv[3] ? JSON.parse((await readFile(process.argv[3], "utf8")).replace(/^\uFEFF/, "")) as Array<{
  workspaceId: string; knowledgeBundleId: string; filePath: string; status: string; reason: string | null;
}> : [];
const root = await mkdtemp(path.join(tmpdir(), "okf-snapshot-verification-"));
const reports = [];
try {
  const bundles = Map.groupBy(snapshot.topics, (topic) => JSON.stringify([topic.workspaceId, topic.knowledgeBundleId]));
  for (const [index, topics] of [...bundles.values()].entries()) {
    const bundleRoot = path.join(root, String(index));
    for (const topic of topics) {
      const target = path.resolve(bundleRoot, topic.exportedFilePath);
      if (!target.startsWith(bundleRoot + path.sep)) throw Error("snapshot_path_outside_bundle");
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, topic.markdown);
    }
    let traversedPaths = 0, projectedPaths = 0, inspectedSeeds = 0;
    const warnings = new Set<string>();
    const connected = new Set<string>();
    let withdrawalPair: string[] | undefined;
    const input = { knowledgeRoot: bundleRoot, knowledgeBundleId: topics[0].knowledgeBundleId,
      workspaceId: topics[0].workspaceId, allowedFiles: topics.map((topic) => topic.exportedFilePath), maxHops: 1,
      lifecycleLookup: async ({ filePath }: { filePath: string }) => {
        const record = lifecycle.find((item) => item.workspaceId === topics[0].workspaceId && item.knowledgeBundleId === topics[0].knowledgeBundleId && item.filePath === filePath);
        return { status: normalizeOkfConceptLifecycleStatus(record?.status), reason: record?.reason };
      } };
    for (const topic of topics) {
      const graph = await traverseOkfRelations({ ...input, seedFiles: [topic.exportedFilePath] });
      if (graph.inspectedFiles?.includes(topic.exportedFilePath)) inspectedSeeds++;
      withdrawalPair ??= graph.paths.find((entry) => entry.files.length > 1)?.files;
      graph.paths.forEach((entry) => entry.files.forEach((file) => connected.add(file)));
    }
    const timings = [];
    for (const seed of connected) {
      const start = performance.now();
      const graph = await traverseOkfRelations({ ...input, seedFiles: [seed], direction: "both" });
      timings.push(performance.now() - start);
      const projected = publishedGraphResult(topics, graph);
      traversedPaths += graph.paths.length;
      projectedPaths += projected.paths.length;
      projected.warnings.forEach((warning) => warnings.add(warning));
    }
    timings.sort((a, b) => a - b);
    const withdrawnFile = withdrawalPair?.[0];
    if (withdrawnFile) {
      const withdrawn = await traverseOkfRelations({ ...input, seedFiles: [withdrawnFile], direction: "both",
        lifecycleLookup: async ({ filePath }) => filePath === withdrawnFile ? { status: "retracted" } : input.lifecycleLookup({ filePath }) });
      const projected = publishedGraphResult(topics, withdrawn);
      if (projected.nodes.length || projected.paths.length) throw Error("withdrawn_seed_reached_agent");
      const neighbor = withdrawalPair![1];
      const fromNeighbor = await traverseOkfRelations({ ...input, seedFiles: [neighbor], direction: "both", maxHops: 3,
        lifecycleLookup: async ({ filePath }) => filePath === withdrawnFile ? { status: "retracted" } : input.lifecycleLookup({ filePath }) });
      if (fromNeighbor.inspectedFiles?.includes(withdrawnFile) || fromNeighbor.paths.some((entry) => entry.files.includes(withdrawnFile)))
        throw Error("withdrawn_target_reached_agent");
    }
    reports.push({ topics: topics.length, inspectedSeeds, connectedSeeds: connected.size, traversedPaths, projectedPaths,
      simulatedWithdrawalChecked: Boolean(withdrawnFile),
      medianMilliseconds: timings.length ? Math.round(timings[Math.floor(timings.length / 2)]) : null,
      maxMilliseconds: timings.length ? Math.round(timings[timings.length - 1]) : null, warnings: [...warnings] });
    const expectedActive = topics.filter((topic) => !lifecycle.some((record) => record.workspaceId === topic.workspaceId && record.knowledgeBundleId === topic.knowledgeBundleId && record.filePath === topic.exportedFilePath && normalizeOkfConceptLifecycleStatus(record.status) !== "active")).length;
    if (inspectedSeeds !== expectedActive) throw Error("published_snapshot_lifecycle_mismatch");
    if (projectedPaths !== traversedPaths) throw Error("agent_projection_lost_paths");
  }
  console.log(JSON.stringify({ source: "read-only-published-snapshot", lifecycle: process.argv[3] ? "database-lifecycle-snapshot" : "assumed-active", reports }, null, 2));
} finally {
  if (!path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep)) throw Error("unsafe_cleanup_path");
  await rm(root, { recursive: true, force: true });
}

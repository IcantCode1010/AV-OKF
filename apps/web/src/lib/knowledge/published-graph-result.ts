import type { OkfRelationPath } from "../okf-graph-retriever.ts";

type PublishedTopic = {
  id: string;
  exportedFilePath: string | null;
  title: string;
  documentId: string;
  sourcePageNumbers: number[];
};

/** Final boundary between graph discovery and model-visible source pointers. */
export function publishedGraphResult<T extends PublishedTopic>(
  topics: T[],
  graph: { concepts: Array<{ filePath: string }>; inspectedFiles?: string[]; paths: OkfRelationPath[]; warnings: string[] },
  truncated = false,
) {
  const byFile = new Map(topics.filter((topic) => topic.exportedFilePath).map((topic) => [topic.exportedFilePath!, topic]));
  const inspected = new Set(graph.inspectedFiles ?? graph.concepts.map((concept) => concept.filePath));
  const warnings = new Set(graph.warnings);
  if (truncated) warnings.add("graph_authorized_topic_budget_exhausted");
  const paths = graph.paths.flatMap((entry) => {
    if (!entry.files.length || entry.relationTypes.length !== entry.files.length - 1 ||
      (entry.directions && entry.directions.length !== entry.relationTypes.length) ||
      entry.files.some((file) => !byFile.has(file) || !inspected.has(file))) {
      warnings.add("graph_path_unavailable");
      return [];
    }
    return [{
      topicIds: entry.files.map((file) => byFile.get(file)!.id),
      connections: entry.relationTypes.map((relation, index) => ({
        sourceTopicId: byFile.get(entry.files[entry.directions?.[index] === "incoming" ? index + 1 : index])!.id,
        targetTopicId: byFile.get(entry.files[entry.directions?.[index] === "incoming" ? index : index + 1])!.id,
        relation,
      })),
    }];
  });
  return {
    trust: "published_links_read_original_sources",
    nodes: [...inspected].flatMap((file) => {
      const topic = byFile.get(file);
      return topic ? [{ id: topic.id, title: topic.title, documentId: topic.documentId,
        sourcePageNumbers: topic.sourcePageNumbers, exportedFilePath: topic.exportedFilePath }] : [];
    }),
    paths,
    warnings: [...warnings],
  };
}

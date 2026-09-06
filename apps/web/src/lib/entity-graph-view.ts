import { getPrisma } from "./prisma.ts";

export type EntityGraphNode = {
  degree: number;
  id: string;
  kind: "alias" | "document" | "entity" | "topic";
  status: string;
  title: string;
  type: string;
};

export type EntityGraphEdge = {
  confidence?: number | null;
  evidenceQuote?: string | null;
  id: string;
  pages: number[];
  reason: string;
  relation: string;
  source: string;
  status: string;
  target: string;
  targetResolution?: string | null;
};

export type EntityGraphSnapshot = {
  edges: EntityGraphEdge[];
  nodes: EntityGraphNode[];
  summary: {
    attention: number;
    entities: number;
    occurrences: number;
    published: number;
  };
};

export async function loadEntityGraphSnapshot(input: {
  attentionOnly?: boolean;
  knowledgeBundleId: string;
  workspaceId: string;
}): Promise<EntityGraphSnapshot> {
  const db = getPrisma();
  const [occurrences, relations] = await Promise.all([
    db.entityOccurrence.findMany({
      include: {
        document: { select: { id: true, title: true } },
        entity: true,
        topic: { select: { id: true, title: true, enrichedTitle: true } },
      },
      orderBy: [{ entity: { canonicalName: "asc" } }, { documentId: "asc" }, { topicId: "asc" }],
      where: { knowledgeBundleId: input.knowledgeBundleId, workspaceId: input.workspaceId },
    }),
    db.entityRelationCandidate.findMany({
      include: {
        sourceTopic: { select: { id: true, title: true, enrichedTitle: true } },
        targetTopic: { select: { id: true, title: true, enrichedTitle: true } },
      },
      orderBy: [{ status: "asc" }, { confidence: "desc" }, { id: "asc" }],
      where: {
        knowledgeBundleId: input.knowledgeBundleId,
        workspaceId: input.workspaceId,
        ...(input.attentionOnly ? { status: { in: ["failed", "filtered", "unresolved"] } } : {}),
      },
    }),
  ]);
  const nodes = new Map<string, EntityGraphNode>();
  const edges: EntityGraphEdge[] = [];
  const addNode = (node: Omit<EntityGraphNode, "degree">) => {
    if (!nodes.has(node.id)) nodes.set(node.id, { ...node, degree: 0 });
  };
  const addEdge = (edge: EntityGraphEdge) => {
    edges.push(edge);
    const source = nodes.get(edge.source);
    const target = nodes.get(edge.target);
    if (source) source.degree += 1;
    if (target) target.degree += 1;
  };

  const attentionTopicIds = new Set(relations.flatMap((relation) => [
    relation.sourceTopicId,
    ...(relation.targetTopicId ? [relation.targetTopicId] : []),
  ]));
  const visibleOccurrences = input.attentionOnly
    ? occurrences.filter((occurrence) =>
        attentionTopicIds.has(occurrence.topicId) ||
        ["provisional", "needs_review"].includes(occurrence.entity.status)
      )
    : occurrences;
  const visibleEntityIds = [...new Set(visibleOccurrences.map((occurrence) => occurrence.entityId))];
  const [aliases, topicLinks] = visibleEntityIds.length > 0
    ? await Promise.all([
        db.entityAlias.findMany({
          include: { entity: true },
          orderBy: [{ normalizedValue: "asc" }, { id: "asc" }],
          where: { entityId: { in: visibleEntityIds }, status: { in: ["accepted", "needs_review"] } },
        }),
        db.entityTopicLink.findMany({
          include: {
            entity: true,
            topic: { select: { id: true, title: true, enrichedTitle: true } },
          },
          orderBy: [{ entity: { canonicalName: "asc" } }, { topicId: "asc" }],
          where: {
            entityId: { in: visibleEntityIds },
            knowledgeBundleId: input.knowledgeBundleId,
            status: "active",
          },
        }),
      ])
    : [[], []];

  for (const occurrence of visibleOccurrences) {
    const entityId = `entity:${occurrence.entityId}`;
    const topicId = `topic:${occurrence.topicId}`;
    const documentId = `document:${occurrence.documentId}`;
    addNode({ id: entityId, kind: "entity", status: occurrence.entity.status, title: occurrence.entity.canonicalName, type: occurrence.entity.entityType });
    addNode({ id: topicId, kind: "topic", status: "grounded", title: occurrence.topic.enrichedTitle ?? occurrence.topic.title, type: "concept" });
    addNode({ id: documentId, kind: "document", status: "source", title: occurrence.document.title, type: "document" });
    addEdge({
      evidenceQuote: occurrence.evidenceQuote,
      id: `mention:${occurrence.id}`,
      pages: occurrence.pageNumbers,
      reason: occurrence.evidenceQuote,
      relation: "mentions",
      source: topicId,
      status: "structural",
      target: entityId,
    });
    addEdge({
      id: `occurrence:${occurrence.id}`,
      pages: occurrence.pageNumbers,
      reason: "Grounded entity occurrence in the source document.",
      relation: "occurs_in",
      source: entityId,
      status: "structural",
      target: documentId,
    });
  }

  for (const alias of aliases) {
    const aliasId = `alias:${alias.id}`;
    const entityId = `entity:${alias.entityId}`;
    addNode({ id: entityId, kind: "entity", status: alias.entity.status, title: alias.entity.canonicalName, type: alias.entity.entityType });
    addNode({ id: aliasId, kind: "alias", status: alias.status, title: alias.value, type: "alias" });
    addEdge({
      id: `alias-link:${alias.id}`,
      pages: [],
      reason: alias.status === "accepted" ? "Accepted alias for this canonical entity." : "Alias requires identity review.",
      relation: "alias_of",
      source: aliasId,
      status: "structural",
      target: entityId,
    });
  }

  for (const link of topicLinks) {
    const entityId = `entity:${link.entityId}`;
    const topicId = `topic:${link.topicId}`;
    addNode({ id: entityId, kind: "entity", status: link.entity.status, title: link.entity.canonicalName, type: link.entity.entityType });
    addNode({ id: topicId, kind: "topic", status: "approved", title: link.topic.enrichedTitle ?? link.topic.title, type: "concept" });
    addEdge({
      id: `topic-link:${link.id}`,
      pages: [],
      reason: "This approved bundle concept represents the canonical entity.",
      relation: "represented_by",
      source: entityId,
      status: "structural",
      target: topicId,
    });
  }

  for (const relation of relations) {
    const source = `topic:${relation.sourceTopicId}`;
    const target = relation.targetTopicId ? `topic:${relation.targetTopicId}` : `unresolved:${relation.id}`;
    addNode({ id: source, kind: "topic", status: "grounded", title: relation.sourceTopic.enrichedTitle ?? relation.sourceTopic.title, type: "concept" });
    addNode({
      id: target,
      kind: "topic",
      status: relation.targetTopic ? relation.status : "unresolved",
      title: relation.targetTopic?.enrichedTitle ?? relation.targetTopic?.title ?? relation.targetResolutionValue ?? "Unresolved target",
      type: relation.targetTopic ? "concept" : "unresolved",
    });
    addEdge({
      confidence: relation.confidence,
      evidenceQuote: relation.evidenceQuote,
      id: `relation:${relation.id}`,
      pages: relation.evidencePageNumbers,
      reason: relation.rationale ?? "Grounded relation assertion.",
      relation: relation.relation,
      source,
      status: relation.status,
      target,
      targetResolution: relation.targetResolution,
    });
  }

  return {
    edges,
    nodes: [...nodes.values()].sort((left, right) => left.kind.localeCompare(right.kind) || left.title.localeCompare(right.title) || left.id.localeCompare(right.id)),
    summary: {
      attention: relations.filter((relation) => ["failed", "filtered", "unresolved"].includes(relation.status)).length,
      entities: new Set(visibleOccurrences.map((occurrence) => occurrence.entityId)).size,
      occurrences: visibleOccurrences.length,
      published: relations.filter((relation) => relation.status === "published").length,
    },
  };
}

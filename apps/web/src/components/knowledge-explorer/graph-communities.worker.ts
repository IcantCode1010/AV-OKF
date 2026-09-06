import { detectGraphCommunities } from "../../lib/graph-communities";
import type { OkfExplorerNode, OkfExplorerEdge } from "../../lib/okf-explorer";

self.onmessage = (event: MessageEvent<{ nodes: OkfExplorerNode[]; edges: OkfExplorerEdge[] }>) => {
  self.postMessage(detectGraphCommunities(event.data.nodes, event.data.edges));
};

// Data lineage — track data flow between domains
export interface LineageEdge {
  id: string;
  sourceDomain: string;
  sourceId: string;
  targetDomain: string;
  targetId: string;
  relationType: string;      // 'references', 'derives_from', 'triggers', 'contains'
  operation: string;         // e.g., 'booking.created', 'journal.posted'
  timestamp: string;
  metadata: Record<string, unknown>;
}

const edges: LineageEdge[] = [];
const MAX_EDGES = 25_000;

export const dataLineage = {
  record(opts: Omit<LineageEdge, 'id' | 'timestamp'>): LineageEdge {
    const edge: LineageEdge = {
      id: crypto.randomUUID(), ...opts, timestamp: new Date().toISOString(),
    };
    edges.push(edge);
    if (edges.length > MAX_EDGES) edges.splice(0, edges.length - MAX_EDGES);
    return edge;
  },

  getUpstream(domain: string, entityId: string): LineageEdge[] {
    return edges.filter(e => e.targetDomain === domain && e.targetId === entityId);
  },

  getDownstream(domain: string, entityId: string): LineageEdge[] {
    return edges.filter(e => e.sourceDomain === domain && e.sourceId === entityId);
  },

  getFullLineage(domain: string, entityId: string, depth = 3): { upstream: LineageEdge[]; downstream: LineageEdge[] } {
    const upstream: LineageEdge[] = [];
    const downstream: LineageEdge[] = [];
    const visited = new Set<string>();

    function traceUp(currentDomain: string, currentId: string, d: number) {
      if (d >= depth || visited.has(`${currentDomain}:${currentId}`)) return;
      visited.add(`${currentDomain}:${currentId}`);
      const up = edges.filter(e => e.targetDomain === currentDomain && e.targetId === currentId);
      for (const e of up) { upstream.push(e); traceUp(e.sourceDomain, e.sourceId, d + 1); }
    }

    function traceDown(currentDomain: string, currentId: string, d: number) {
      if (d >= depth || visited.has(`${currentDomain}:${currentId}`)) return;
      visited.add(`${currentDomain}:${currentId}`);
      const down = edges.filter(e => e.sourceDomain === currentDomain && e.sourceId === currentId);
      for (const e of down) { downstream.push(e); traceDown(e.targetDomain, e.targetId, d + 1); }
    }

    traceUp(domain, entityId, 0);
    traceDown(domain, entityId, 0);
    return { upstream, downstream };
  },

  getGraph(): { nodes: Array<{ domain: string; id: string }>; edges: LineageEdge[] } {
    const nodeSet = new Set<string>();
    const graphNodes: Array<{ domain: string; id: string }> = [];

    for (const e of edges) {
      const sk = `${e.sourceDomain}:${e.sourceId}`;
      const tk = `${e.targetDomain}:${e.targetId}`;
      if (!nodeSet.has(sk)) { nodeSet.add(sk); graphNodes.push({ domain: e.sourceDomain, id: e.sourceId }); }
      if (!nodeSet.has(tk)) { nodeSet.add(tk); graphNodes.push({ domain: e.targetDomain, id: e.targetId }); }
    }

    return { nodes: graphNodes, edges };
  },

  getStats(): { totalEdges: number; byRelation: Record<string, number>; domains: string[] } {
    const byRelation: Record<string, number> = {};
    const domainSet = new Set<string>();

    for (const e of edges) {
      byRelation[e.relationType] = (byRelation[e.relationType] ?? 0) + 1;
      domainSet.add(e.sourceDomain);
      domainSet.add(e.targetDomain);
    }

    return { totalEdges: edges.length, byRelation, domains: [...domainSet] };
  },
};

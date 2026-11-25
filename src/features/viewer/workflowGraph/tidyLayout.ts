import dagre from '@dagrejs/dagre';

/** What the layout worker receives: sizes and connections only, never node text. */
export interface LayoutInput {
    nodes: { id: string; width: number; height: number }[];
    edges: { from: string; to: string }[];
}

export type LayoutRequest = { requestId: number; input: LayoutInput };
export type LayoutResponse =
    { requestId: number; positions: Record<string, { x: number; y: number }> } | { requestId: number; error: 'layout_failed' };

/** Left-to-right ranks, as a ComfyUI graph reads. Returns each node's top-left corner. */
export const tidyLayout = (input: LayoutInput): Record<string, { x: number; y: number }> => {
    const graph = new dagre.graphlib.Graph({ multigraph: false });
    graph.setGraph({ rankdir: 'LR', nodesep: 36, ranksep: 90, marginx: 0, marginy: 0 });
    graph.setDefaultEdgeLabel(() => ({}));
    const ids = new Set<string>();
    for (const node of input.nodes) {
        ids.add(node.id);
        graph.setNode(node.id, { width: node.width, height: node.height });
    }
    for (const edge of input.edges) {
        if (edge.from !== edge.to && ids.has(edge.from) && ids.has(edge.to)) graph.setEdge(edge.from, edge.to);
    }
    dagre.layout(graph);

    const positions: Record<string, { x: number; y: number }> = {};
    for (const node of input.nodes) {
        const laid = graph.node(node.id) as { x: number; y: number };
        positions[node.id] = { x: Math.round(laid.x - node.width / 2), y: Math.round(laid.y - node.height / 2) };
    }
    return positions;
};

/** The worker's whole contract, kept here so it is testable without a Worker. Failures carry no node text. */
export const handleLayoutRequest = (request: LayoutRequest): LayoutResponse => {
    try {
        return { requestId: request.requestId, positions: tidyLayout(request.input) };
    } catch {
        return { requestId: request.requestId, error: 'layout_failed' };
    }
};

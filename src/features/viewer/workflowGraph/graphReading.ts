import type { Rect } from './geometry';
import type { GraphModel, GraphNode, GraphPort, WireType } from './graphModel';

/**
 * Reading a graph: what a node is wired to (the side panel), finding nodes by text (search), and moving between
 * nodes with the arrow keys. Pure functions over the model, so the view only renders their answers.
 */

export interface LinkRow {
    key: string;
    /** This node's port the wire meets. */
    port: string;
    other: GraphNode;
    /** The other node's port. */
    otherPort: string;
    type: WireType;
}

const portLabel = (ports: GraphPort[], slot: number, side: 'input' | 'output') =>
    ports.find((port) => port.slot === slot)?.label || `${side} ${slot + 1}`;

/** The wires into a node (where its inputs come from) and out of it (where its outputs go), in port order. */
export const linksOf = (model: GraphModel, id: string): { from: LinkRow[]; to: LinkRow[] } => {
    const node = model.byId.get(id);
    if (!node) return { from: [], to: [] };
    const from: (LinkRow & { slot: number })[] = [];
    const to: (LinkRow & { slot: number })[] = [];
    for (const link of model.links) {
        if (link.to === id) {
            const other = model.byId.get(link.from);
            if (other) {
                from.push({
                    key: link.key,
                    slot: link.toSlot,
                    port: portLabel(node.inputs, link.toSlot, 'input'),
                    other,
                    otherPort: portLabel(other.outputs, link.fromSlot, 'output'),
                    type: link.type,
                });
            }
        }
        if (link.from === id) {
            const other = model.byId.get(link.to);
            if (other) {
                to.push({
                    key: link.key,
                    slot: link.fromSlot,
                    port: portLabel(node.outputs, link.fromSlot, 'output'),
                    other,
                    otherPort: portLabel(other.inputs, link.toSlot, 'input'),
                    type: link.type,
                });
            }
        }
    }
    const bySlot = (a: { slot: number }, b: { slot: number }) => a.slot - b.slot;
    return { from: from.sort(bySlot), to: to.sort(bySlot) };
};

export interface SearchResult {
    id: string;
    title: string;
    /** What else matched, or the node type when the title did. */
    detail: string;
}

export interface SearchHits {
    ids: ReadonlySet<string>;
    /** At most SEARCH_RESULT_LIMIT rows, title matches first. */
    results: SearchResult[];
    total: number;
}

export const SEARCH_RESULT_LIMIT = 20;
const DETAIL_CHARS = 60;

/**
 * Nodes whose title, type, setting names or values hold every word of the query, case ignored. Reroutes have no
 * text, so they never match. An empty query is no search.
 */
export const searchGraph = (model: GraphModel, query: string): SearchHits | null => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return null;
    const inTitle: SearchResult[] = [];
    const inBody: SearchResult[] = [];
    const ids = new Set<string>();
    for (const node of model.nodes) {
        if (node.kind === 'reroute') continue;
        const head = `${node.title}\n${node.nodeType}`.toLowerCase();
        const settings = node.widgets.map((widget) => `${widget.name ?? ''}\n${widget.value}`.toLowerCase());
        const hay = `${head}\n${settings.join('\n')}`;
        if (!words.every((word) => hay.includes(word))) continue;
        ids.add(node.id);
        if (words.every((word) => head.includes(word))) {
            inTitle.push({ id: node.id, title: node.title, detail: node.nodeType });
            continue;
        }
        const index = settings.findIndex((text) => words.some((word) => text.includes(word)));
        const widget = node.widgets[index];
        const value = widget ? widget.value.replace(/\s+/g, ' ') : '';
        const shown = value.length > DETAIL_CHARS ? `${value.slice(0, DETAIL_CHARS)}…` : value;
        inBody.push({ id: node.id, title: node.title, detail: widget?.name ? `${widget.name}: ${shown}` : shown });
    }
    const all = [...inTitle, ...inBody];
    return { ids, results: all.slice(0, SEARCH_RESULT_LIMIT), total: all.length };
};

export type NavDirection = 'left' | 'right' | 'up' | 'down';

const centre = (rect: Rect) => ({ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 });

/**
 * The nearest drawn node in a direction. One that overlaps the current node across that direction wins (the node
 * straight below, say); failing that, the nearest by distance, with sideways distance weighed double.
 */
const nearestToward = (rects: ReadonlyMap<string, Rect>, id: string, direction: NavDirection): string | null => {
    const from = rects.get(id);
    if (!from) return null;
    const a = centre(from);
    const vertical = direction === 'up' || direction === 'down';
    let best: string | null = null;
    let bestOverlaps = false;
    let bestScore = Infinity;
    for (const [key, rect] of rects) {
        if (key === id) continue;
        const b = centre(rect);
        const ahead = { down: b.y - a.y, up: a.y - b.y, right: b.x - a.x, left: a.x - b.x }[direction];
        if (ahead <= 0) continue;
        const overlaps = vertical
            ? rect.x < from.x + from.w && from.x < rect.x + rect.w
            : rect.y < from.y + from.h && from.y < rect.y + rect.h;
        const sideways = vertical ? Math.abs(b.x - a.x) : Math.abs(b.y - a.y);
        const score = overlaps ? ahead : ahead + 2 * sideways;
        if ((overlaps && !bestOverlaps) || (overlaps === bestOverlaps && score < bestScore)) {
            best = key;
            bestOverlaps = overlaps;
            bestScore = score;
        }
    }
    return best;
};

/**
 * Where an arrow key goes from a node. Right follows its first output wire and Left its first input wire, to a node
 * that is drawn; with no such wire they go to the nearest node that way, as Up and Down always do. `rects` holds the
 * drawn nodes only. Null when nothing lies that way.
 */
export const nextNode = (model: GraphModel, rects: ReadonlyMap<string, Rect>, id: string, direction: NavDirection): string | null => {
    if (direction === 'right' || direction === 'left') {
        const { from, to } = linksOf(model, id);
        const wired = (direction === 'right' ? to : from).find((row) => row.other.id !== id && rects.has(row.other.id));
        if (wired) return wired.other.id;
    }
    return nearestToward(rects, id, direction);
};

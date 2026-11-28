import type {
    WorkflowCanvasLevel,
    WorkflowCanvasNode,
    WorkflowCanvasNodeKind,
    WorkflowCanvasNodeMode,
    WorkflowCanvasPort,
} from '../../../bindings';

// Every string below that comes from the file is untrusted: it is only ever rendered as React text.

/** ComfyUI draws a node's title bar above its saved position. */
export const HEADER_H = 30;
export const REROUTE_SIZE = 18;
/** The row under a subgraph instance that opens its level. */
export const DOOR_H = 28;
export const FOLDED_GROUP_W = 240;
export const FOLDED_GROUP_H = 46;
const BODY_PAD_TOP = 5;
const BODY_PAD_BOTTOM = 8;
const SLOT_H = 20;
const WIDGET_H = 25;
const LONG_WIDGET_H = 94;
const NOTE_H = 160;
const DEFAULT_W = 260;
const NOTE_W = 300;
const MIN_W = 120;
/** Positions and sizes from the file can be negative or huge: they are clamped before layout and drawing. */
export const COORD_LIMIT = 1_000_000;
const SIZE_LIMIT = 8_000;
/** A setting shows at most this many characters; the full value stays in the file. */
export const WIDGET_TEXT_LIMIT = 2_000;

export type WireType = 'model' | 'clip' | 'vae' | 'cond' | 'latent' | 'noise' | 'image' | 'upscale' | 'mask' | 'control' | 'meta' | 'any';

const WIRE_TYPES: Record<string, WireType> = {
    MODEL: 'model',
    UNET: 'model',
    CLIP: 'clip',
    VAE: 'vae',
    CONDITIONING: 'cond',
    LATENT: 'latent',
    NOISE: 'noise',
    IMAGE: 'image',
    UPSCALE_MODEL: 'upscale',
    MASK: 'mask',
    CONTROL_NET: 'control',
    METADATA: 'meta',
};

/** Maps a file's type name to a fixed token key, so no file string ever reaches a class name. */
export const wireTypeOf = (dataType: string): WireType => WIRE_TYPES[dataType.toUpperCase()] ?? 'any';

export interface GraphPort {
    slot: number;
    label: string;
    type: WireType;
    linked: boolean;
}

export interface GraphWidget {
    /** Null when the file does not say which setting the value belongs to; nothing stands in for the name. */
    name: string | null;
    value: string;
    isLongText: boolean;
}

export interface GraphNode {
    id: string;
    kind: WorkflowCanvasNodeKind;
    title: string;
    nodeType: string;
    /** For a subgraph instance, the definition its level comes from. */
    subgraphId: string | null;
    /** For a subgraph instance the report has a definition for, the nodes on its level; otherwise null. */
    inside: number | null;
    /** The node as saved, for the side panel; null past the report's byte caps. */
    rawJson: string | null;
    mode: WorkflowCanvasNodeMode;
    collapsed: boolean;
    width: number;
    /** Estimated drawn height, used for layout and fitting. */
    height: number;
    /** The saved body height plus the title bar, or 0. */
    minHeight: number;
    saved: { x: number; y: number } | null;
    inputs: GraphPort[];
    outputs: GraphPort[];
    widgets: GraphWidget[];
    /** Port centre offsets from the node's top edge, by slot. */
    inPin: Map<number, number>;
    outPin: Map<number, number>;
}

export interface GraphLink {
    key: string;
    from: string;
    fromSlot: number;
    to: string;
    toSlot: number;
    type: WireType;
}

export interface GraphGroup {
    key: string;
    title: string;
    x: number;
    y: number;
    w: number;
    h: number;
    color: string | null;
    members: string[];
}

export interface GraphModel {
    nodes: GraphNode[];
    byId: Map<string, GraphNode>;
    links: GraphLink[];
    groups: GraphGroup[];
}

export type Point = { x: number; y: number };
export type Positions = Map<string, Point>;

export const clampCoord = (value: number): number => (Number.isFinite(value) ? Math.min(Math.max(value, -COORD_LIMIT), COORD_LIMIT) : 0);
const clampSize = (value: number, min: number): number => (Number.isFinite(value) ? Math.min(Math.max(value, min), SIZE_LIMIT) : min);

const clip = (value: string): string => (value.length > WIDGET_TEXT_LIMIT ? `${value.slice(0, WIDGET_TEXT_LIMIT)}…` : value);

const toPort = (port: WorkflowCanvasPort): GraphPort => ({
    slot: port.slot,
    label: port.label || port.name,
    type: wireTypeOf(port.dataType),
    linked: port.linked,
});

/** The first port row's centre: border, title bar, body padding, half a row. */
const FIRST_PIN = 1 + HEADER_H + BODY_PAD_TOP + SLOT_H / 2;

/** What the graph knows of a subgraph definition: its name, and how many nodes its level holds. */
export interface SubgraphInfo {
    name: string;
    nodes: number;
}

const buildNode = (node: WorkflowCanvasNode, subgraphs: ReadonlyMap<string, SubgraphInfo>): GraphNode => {
    const definition = node.kind === 'subgraph' && node.subgraphId ? subgraphs.get(node.subgraphId) : undefined;
    const inputs = node.inputs.map(toPort);
    const outputs = node.outputs.map(toPort);
    const widgets = node.widgets.map((widget) => ({
        name: widget.name,
        value: clip(widget.value),
        isLongText: widget.isLongText,
    }));
    const inPin = new Map<number, number>();
    const outPin = new Map<number, number>();
    if (node.kind === 'reroute') {
        inputs.forEach((port) => inPin.set(port.slot, REROUTE_SIZE / 2));
        outputs.forEach((port) => outPin.set(port.slot, REROUTE_SIZE / 2));
    } else {
        inputs.forEach((port, row) => inPin.set(port.slot, FIRST_PIN + row * SLOT_H));
        outputs.forEach((port, row) => outPin.set(port.slot, FIRST_PIN + row * SLOT_H));
    }

    const savedHeight = node.size ? HEADER_H + clampSize(node.size.height, 0) : 0;
    let width: number;
    let height: number;
    if (node.kind === 'reroute') {
        width = REROUTE_SIZE;
        height = REROUTE_SIZE;
    } else if (node.kind === 'note') {
        width = node.size ? clampSize(node.size.width, MIN_W) : NOTE_W;
        height = Math.max(savedHeight, NOTE_H);
    } else {
        width = node.size ? clampSize(node.size.width, MIN_W) : DEFAULT_W;
        const rows = Math.max(inputs.length, outputs.length);
        const widgetHeight = widgets.reduce((sum, widget) => sum + (widget.isLongText ? LONG_WIDGET_H : WIDGET_H), 0);
        height = Math.max(savedHeight, 1 + HEADER_H + BODY_PAD_TOP + rows * SLOT_H + widgetHeight + BODY_PAD_BOTTOM);
        // The open row sits under the body as the file saved it.
        if (definition) height += DOOR_H;
    }

    // The title bar sits above the saved position; a reroute is drawn at its position.
    const saved = node.pos ? { x: clampCoord(node.pos.x), y: clampCoord(node.pos.y - (node.kind === 'reroute' ? 0 : HEADER_H)) } : null;

    return {
        id: node.id,
        kind: node.kind,
        // A subgraph instance is named as its breadcrumb is: the definition's name first, as its type is a UUID.
        title: definition?.name || node.title || node.nodeType,
        nodeType: node.nodeType,
        subgraphId: node.subgraphId,
        inside: definition ? definition.nodes : null,
        rawJson: node.rawJson,
        mode: node.mode,
        collapsed: node.collapsed,
        width,
        height,
        minHeight: node.kind === 'reroute' ? 0 : savedHeight,
        saved,
        inputs,
        outputs,
        widgets,
        inPin,
        outPin,
    };
};

/**
 * ComfyUI's rule (LGraphGroup.recomputeInsideNodes): a node belongs to a group when the centre of its saved box,
 * title bar included, lies inside the group's bounds; right and bottom edges excluded.
 */
const insideGroup = (node: GraphNode, group: GraphGroup): boolean => {
    if (!node.saved) return false;
    const height = node.kind === 'reroute' ? 0 : node.collapsed ? HEADER_H : node.minHeight || node.height;
    const width = node.kind === 'reroute' ? 0 : node.width;
    const cx = node.saved.x + width / 2;
    const cy = node.saved.y + height / 2;
    return cx >= group.x && cx < group.x + group.w && cy >= group.y && cy < group.y + group.h;
};

/** `subgraphs` maps a subgraph definition's id to its name and size, for the instances' titles and open rows. */
export const buildGraphModel = (level: WorkflowCanvasLevel, subgraphs: ReadonlyMap<string, SubgraphInfo> = new Map()): GraphModel => {
    const nodes: GraphNode[] = [];
    const byId = new Map<string, GraphNode>();
    for (const raw of level.nodes) {
        if (byId.has(raw.id)) continue;
        const node = buildNode(raw, subgraphs);
        nodes.push(node);
        byId.set(node.id, node);
    }

    // A link to a node the level lacks is dropped; a link to a slot its node does not list still draws.
    const links: GraphLink[] = [];
    level.links.forEach((link, index) => {
        if (!byId.has(link.fromNode) || !byId.has(link.toNode)) return;
        links.push({
            key: String(index),
            from: link.fromNode,
            fromSlot: link.fromSlot,
            to: link.toNode,
            toSlot: link.toSlot,
            type: wireTypeOf(link.dataType),
        });
    });

    const groups: GraphGroup[] = level.groups.map((group, index) => {
        const result: GraphGroup = {
            key: String(index),
            title: group.title,
            x: clampCoord(group.pos.x),
            y: clampCoord(group.pos.y),
            w: clampSize(group.size.width, 0),
            h: clampSize(group.size.height, 0),
            color: group.color,
            members: [],
        };
        result.members = nodes.filter((node) => insideGroup(node, result)).map((node) => node.id);
        return result;
    });

    return { nodes, byId, links, groups };
};

/** The layout as saved. Nodes the file left without a position go in a row below the rest. */
export const savedPositions = (model: GraphModel): Positions => {
    const positions: Positions = new Map();
    let bottom = 0;
    let left = Infinity;
    for (const node of model.nodes) {
        if (!node.saved) continue;
        positions.set(node.id, node.saved);
        bottom = Math.max(bottom, node.saved.y + node.height);
        left = Math.min(left, node.saved.x);
    }
    let x = Number.isFinite(left) ? left : 0;
    for (const node of model.nodes) {
        if (node.saved) continue;
        positions.set(node.id, { x, y: bottom + 80 });
        x += node.width + 40;
    }
    return positions;
};

export const hasSavedPositions = (model: GraphModel): boolean => model.nodes.some((node) => node.saved !== null);

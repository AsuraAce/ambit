import {
    FOLDED_GROUP_H,
    FOLDED_GROUP_W,
    HEADER_H,
    REROUTE_SIZE,
    type GraphGroup,
    type GraphModel,
    type GraphNode,
    type Point,
    type Positions,
    type WireType,
} from './graphModel';

export type LayoutMode = 'saved' | 'tidy';
export type WireShape = 'bundled' | 'curved';

export interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface View {
    x: number;
    y: number;
    s: number;
}

/** The usual zoom-out limit. A graph too big to fit at it may zoom out further, down to LOWEST_SCALE. */
export const MIN_SCALE = 0.12;
/** The lowest zoom for any graph: Fit and zooming out never go below it. */
export const LOWEST_SCALE = 0.02;
export const MAX_SCALE = 2;
/** Below this scale the far canvas draws the graph, nodes showing only their titles. */
export const FAR_SCALE = 0.5;
/** Far mode, once on, holds until this scale, so a zoom resting near FAR_SCALE does not flicker between the two. */
export const FAR_EXIT_SCALE = 0.55;
/** Below this scale the far canvas shows the overview: node shapes and group titles, no node text. */
export const OVERVIEW_SCALE = 0.22;
/** A group title pill's height, in world units, inside the group's top band. */
export const GROUP_TITLE_H = 24;

/** How long a group fold takes; workflowGraph.css uses the same time. */
export const FOLD_MS = 220;

export type ViewLevel = 'near' | 'far' | 'overview';

/** What the view draws at scale s, given whether far mode was on. */
export const viewLevel = (s: number, wasFar: boolean): ViewLevel => {
    if (s >= (wasFar ? FAR_EXIT_SCALE : FAR_SCALE)) return 'near';
    return s < OVERVIEW_SCALE ? 'overview' : 'far';
};

/** Above this scale a node's body text shows in full; it fades out between here and FAR_SCALE. */
export const DETAIL_FADE_SCALE = 0.65;
/** How many steps the fade takes; workflowGraph.css holds one opacity rule per step. */
export const DETAIL_STEPS = 3;

/**
 * How visible the near view's detail text is at scale s: gone at FAR_SCALE, full from DETAIL_FADE_SCALE, in a few
 * steps between, so a zoom sweep restyles the nodes a few times instead of on every frame. The owner's wheel takes
 * big steps, so the text has to be on its way out before the canvas takes over rather than vanish in the swap.
 */
export const detailOpacity = (s: number): number => {
    if (s >= DETAIL_FADE_SCALE) return 1;
    if (s <= FAR_SCALE) return 0;
    // Less a hair, so a scale on a step's edge (0.55 is 1.0000000000000004 steps in) lands on that step.
    return Math.ceil(((s - FAR_SCALE) / (DETAIL_FADE_SCALE - FAR_SCALE)) * DETAIL_STEPS - 1e-9) / DETAIL_STEPS;
};

export const clampScale = (s: number, floor = MIN_SCALE): number => Math.min(Math.max(s, floor), MAX_SCALE);

/** Which folded group hides each node, and which groups sit inside a folded group. Groups apply only as saved. */
export interface Scene {
    hiddenBy: Map<string, GraphGroup>;
    hiddenGroups: Set<string>;
}

const area = (group: GraphGroup) => group.w * group.h;
const contains = (outer: GraphGroup, inner: GraphGroup) =>
    inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

export const sceneFor = (model: GraphModel, layout: LayoutMode, foldedGroups: ReadonlySet<string>): Scene => {
    const hiddenBy = new Map<string, GraphGroup>();
    const hiddenGroups = new Set<string>();
    if (layout !== 'saved') {
        model.groups.forEach((group) => hiddenGroups.add(group.key));
        return { hiddenBy, hiddenGroups };
    }
    // The outermost folded group wins, so a fold inside a fold anchors at the outer one.
    const folded = model.groups.filter((group) => foldedGroups.has(group.key)).sort((a, b) => area(b) - area(a));
    for (const group of folded) {
        if (hiddenGroups.has(group.key)) continue;
        for (const id of group.members) if (!hiddenBy.has(id)) hiddenBy.set(id, group);
        for (const other of model.groups) if (other !== group && contains(group, other)) hiddenGroups.add(other.key);
    }
    return { hiddenBy, hiddenGroups };
};

export const groupBox = (group: GraphGroup, folded: boolean): Rect =>
    folded ? { x: group.x, y: group.y, w: FOLDED_GROUP_W, h: FOLDED_GROUP_H } : { x: group.x, y: group.y, w: group.w, h: group.h };

export const nodeHeight = (node: GraphNode, folded: boolean): number =>
    node.kind === 'reroute' ? REROUTE_SIZE : folded ? HEADER_H : node.height;

/** Where a wire meets a node: its port, the title bar of a folded node, or the edge of a folded group hiding it. */
export const endpoint = (
    node: GraphNode,
    at: Point,
    side: 'in' | 'out',
    slot: number,
    folded: boolean,
    hiddenBy: GraphGroup | undefined
): Point => {
    if (hiddenBy) return { x: side === 'out' ? hiddenBy.x + FOLDED_GROUP_W : hiddenBy.x, y: hiddenBy.y + FOLDED_GROUP_H / 2 };
    if (node.kind === 'reroute') return { x: at.x + (side === 'out' ? REROUTE_SIZE : 0), y: at.y + REROUTE_SIZE / 2 };
    const pins = side === 'out' ? node.outPin : node.inPin;
    // A slot the node does not list, or a folded node, meets the wire at the title bar.
    const dy = folded ? HEADER_H / 2 : (pins.get(slot) ?? HEADER_H / 2);
    return { x: at.x + (side === 'out' ? node.width : 0), y: at.y + dy };
};

const f = (n: number) => n.toFixed(1);

export const curvePath = (a: Point, b: Point): string => {
    const dx = Math.max(36, Math.abs(b.x - a.x) * 0.5);
    return `M${f(a.x)} ${f(a.y)} C${f(a.x + dx)} ${f(a.y)} ${f(b.x - dx)} ${f(b.y)} ${f(b.x)} ${f(b.y)}`;
};

/**
 * A polyline with its inner corners rounded to radius r. Every corner is a line and a curve, even one too tight to
 * round, so routes through the same number of points share one command list and a fold can ease one into another.
 */
export const roundedPath = (pts: Point[], r: number): string => {
    let d = `M${f(pts[0].x)} ${f(pts[0].y)}`;
    for (let i = 1; i < pts.length - 1; i++) {
        const a = pts[i - 1];
        const p = pts[i];
        const b = pts[i + 1];
        const la = Math.hypot(p.x - a.x, p.y - a.y);
        const lb = Math.hypot(b.x - p.x, b.y - p.y);
        const k = Math.min(r, la / 2, lb / 2);
        if (k < 0.5) {
            d += ` L${f(p.x)} ${f(p.y)} Q${f(p.x)} ${f(p.y)} ${f(p.x)} ${f(p.y)}`;
            continue;
        }
        const p1 = { x: p.x + ((a.x - p.x) / la) * k, y: p.y + ((a.y - p.y) / la) * k };
        const p2 = { x: p.x + ((b.x - p.x) / lb) * k, y: p.y + ((b.y - p.y) / lb) * k };
        d += ` L${f(p1.x)} ${f(p1.y)} Q${f(p.x)} ${f(p.y)} ${f(p2.x)} ${f(p2.y)}`;
    }
    const z = pts[pts.length - 1];
    return `${d} L${f(z.x)} ${f(z.y)}`;
};

/** A wire that runs backwards or nearly upright steps out, across and back in. */
export const angledPath = (a: Point, b: Point): string => {
    if (b.x - a.x > 40) {
        const mx = Math.round((a.x + b.x) / 2);
        return roundedPath([a, { x: mx, y: a.y }, { x: mx, y: b.y }, b], 10);
    }
    const s = 20;
    const my = (a.y + b.y) / 2;
    return roundedPath([a, { x: a.x + s, y: a.y }, { x: a.x + s, y: my }, { x: b.x - s, y: my }, { x: b.x - s, y: b.y }, b], 10);
};

/** Bundled: every wire from one output turns at the same x, its trunk, so they share one line and split near their targets. */
export const bundledPath = (a: Point, b: Point, trunkX: number): string => {
    if (b.x - a.x <= 40) return angledPath(a, b);
    return roundedPath([a, { x: trunkX, y: a.y }, { x: trunkX, y: b.y }, b], 10);
};

export interface WirePath {
    key: string;
    d: string;
    type: WireType;
    bypassed: boolean;
}

export const wirePaths = (
    model: GraphModel,
    positions: Positions,
    foldedNodes: ReadonlySet<string>,
    scene: Scene,
    shape: WireShape
): WirePath[] => {
    const ends: { key: string; from: string; a: Point; b: Point; type: WireType; bypassed: boolean; outKey: string }[] = [];
    for (const link of model.links) {
        const source = model.byId.get(link.from);
        const target = model.byId.get(link.to);
        const sourceAt = positions.get(link.from);
        const targetAt = positions.get(link.to);
        if (!source || !target || !sourceAt || !targetAt) continue;
        const sourceGroup = scene.hiddenBy.get(link.from);
        const targetGroup = scene.hiddenBy.get(link.to);
        // Wires inside one folded group are tucked away with it.
        if (sourceGroup && sourceGroup === targetGroup) continue;
        ends.push({
            key: link.key,
            from: link.from,
            a: endpoint(source, sourceAt, 'out', link.fromSlot, foldedNodes.has(link.from), sourceGroup),
            b: endpoint(target, targetAt, 'in', link.toSlot, foldedNodes.has(link.to), targetGroup),
            type: link.type,
            bypassed: source.mode === 'bypassed' || target.mode === 'bypassed',
            outKey: `${link.from}\u0000${link.fromSlot}`,
        });
    }

    // One pass builds each output's trunk: the nearest forward target, less a margin.
    const nearestTarget = new Map<string, number>();
    if (shape === 'bundled') {
        for (const end of ends) {
            if (end.b.x - end.a.x <= 40) continue;
            const current = nearestTarget.get(end.outKey);
            if (current === undefined || end.b.x < current) nearestTarget.set(end.outKey, end.b.x);
        }
    }

    return ends.map((end) => {
        let d: string;
        if (shape === 'bundled') {
            const nearest = nearestTarget.get(end.outKey) ?? Infinity;
            d = bundledPath(end.a, end.b, Math.max(end.a.x + 20, nearest - 28));
        } else {
            d = curvePath(end.a, end.b);
        }
        return { key: end.key, d, type: end.type, bypassed: end.bypassed };
    });
};

/** The drawn extent: visible nodes and visible group boxes. */
export const boundsOf = (
    model: GraphModel,
    positions: Positions,
    foldedNodes: ReadonlySet<string>,
    foldedGroups: ReadonlySet<string>,
    scene: Scene
): Rect | null => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const add = (x: number, y: number, w: number, h: number) => {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + w);
        maxY = Math.max(maxY, y + h);
    };
    for (const node of model.nodes) {
        const at = positions.get(node.id);
        if (!at || scene.hiddenBy.has(node.id)) continue;
        add(at.x, at.y, node.width, nodeHeight(node, foldedNodes.has(node.id)));
    }
    for (const group of model.groups) {
        if (scene.hiddenGroups.has(group.key)) continue;
        const folded = foldedGroups.has(group.key);
        const box = groupBox(group, folded);
        add(box.x, box.y, box.w, box.h);
    }
    if (!Number.isFinite(minX)) return null;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
};

const PAD_X = 48;
const PAD_Y = 56;

/** The view that shows the whole rect, centred, never larger than maxScale nor smaller than LOWEST_SCALE. */
export const fitView = (bounds: Rect, viewport: { w: number; h: number }, maxScale = 1.05): View => {
    const s = clampScale(
        Math.min(maxScale, (viewport.w - PAD_X * 2) / Math.max(bounds.w, 1), (viewport.h - PAD_Y * 2) / Math.max(bounds.h, 1)),
        LOWEST_SCALE
    );
    return {
        s,
        x: viewport.w / 2 - (bounds.x + bounds.w / 2) * s,
        y: viewport.h / 2 - (bounds.y + bounds.h / 2) * s,
    };
};

/** How far this graph may zoom out: MIN_SCALE, or lower when that is what fitting it takes. */
export const zoomFloor = (bounds: Rect | null, viewport: { w: number; h: number }): number =>
    bounds ? Math.min(MIN_SCALE, fitView(bounds, viewport).s) : MIN_SCALE;

/** The first view: the whole graph, never above 100 %. */
export const startView = (bounds: Rect, viewport: { w: number; h: number }): View => fitView(bounds, viewport, 1);

/** Zoom by factor f around the screen point (cx, cy), keeping that point still; `floor` is the zoom-out limit. */
export const zoomAt = (view: View, factor: number, cx: number, cy: number, floor = MIN_SCALE): View => {
    const s = clampScale(view.s * factor, floor);
    const k = s / view.s;
    return { s, x: cx - (cx - view.x) * k, y: cy - (cy - view.y) * k };
};

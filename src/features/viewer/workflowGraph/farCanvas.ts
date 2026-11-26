import type { GraphModel, Positions, WireType } from './graphModel';
import { FAR_SCALE, GROUP_TAB_H, groupBox, nodeHeight, type Rect, type Scene, type View, type ViewLevel, type WirePath } from './geometry';
import { dropOverlaps, fitOverviewTitle, fitText, GROUP_TITLE_CAP_PX, keepsEnough, placeGroupTitle, type Measure } from './groupTitles';

/**
 * Far mode draws the graph on one canvas instead of thousands of HTML elements, so a pan or zoom step
 * re-rasters a few hundred shapes. It is presentation only: the boxes and wires come from the same model,
 * positions, folds and wire paths the HTML view draws. It has two levels: far, with node titles, and the
 * overview, where group titles are the only text.
 */

export interface FarNode extends Rect {
    id: string;
    title: string;
    nodeType: string | null;
    variant: 'plain' | 'bypass' | 'mute' | 'reroute';
    /** The innermost open group the node belongs to, whose colour tints it in the overview. */
    group: string | null;
    /** A selected output: its title stays in the overview, as an anchor for the eye. */
    anchor: boolean;
}

export interface FarGroup extends Rect {
    key: string;
    title: string;
    count: number;
    shut: boolean;
}

export interface FarScene {
    groups: FarGroup[];
    nodes: FarNode[];
    wires: WirePath[];
}

const areaOf = (rect: Rect) => rect.w * rect.h;

/**
 * What the HTML view would show, as plain boxes. Hidden members of folded groups are left out, as there. The HTML
 * sets only a minimum height, so a node's laid-out height, when given, wins over the model's estimate.
 */
export const farSceneFor = (
    model: GraphModel,
    positions: Positions,
    foldedNodes: ReadonlySet<string>,
    foldedGroups: ReadonlySet<string>,
    scene: Scene,
    wires: WirePath[],
    laidOut: ReadonlyMap<string, number> = new Map(),
    anchors: ReadonlySet<string> = new Set()
): FarScene => {
    const groups = model.groups
        .filter((group) => !scene.hiddenGroups.has(group.key))
        .map((group) => {
            const shut = foldedGroups.has(group.key);
            return { key: group.key, title: group.title, count: group.members.length, shut, ...groupBox(group, shut) };
        });
    const innermost = new Map<string, string>();
    for (const group of model.groups
        .filter((candidate) => !scene.hiddenGroups.has(candidate.key) && !foldedGroups.has(candidate.key))
        .sort((a, b) => areaOf(a) - areaOf(b))) {
        for (const id of group.members) if (!innermost.has(id)) innermost.set(id, group.key);
    }
    return {
        groups,
        nodes: model.nodes.flatMap((node): FarNode[] => {
            const at = positions.get(node.id);
            if (!at || scene.hiddenBy.has(node.id)) return [];
            const folded = foldedNodes.has(node.id);
            const h = laidOut.get(node.id) ?? nodeHeight(node, folded);
            const variant =
                node.kind === 'reroute' ? 'reroute' : node.mode === 'bypassed' ? 'bypass' : node.mode === 'muted' ? 'mute' : 'plain';
            return [
                {
                    id: node.id,
                    title: node.title,
                    nodeType: node.title !== node.nodeType ? node.nodeType : null,
                    variant,
                    group: innermost.get(node.id) ?? null,
                    anchor: anchors.has(node.id),
                    x: at.x,
                    y: at.y,
                    w: node.width,
                    h,
                },
            ];
        }),
        wires,
    };
};

interface GroupLook {
    fill: string;
    stroke: string;
    titleColour: string;
    tabFill: string;
    tabStroke: string;
}

/** Colours and font, read from the rendered HTML so the token file stays their only source. */
export interface FarPalette {
    font: string;
    text: string;
    muted: string;
    node: Record<FarNode['variant'], { fill: string; stroke: string; alpha: number; dashed: boolean }>;
    wire: Partial<Record<WireType, string>>;
    group: Map<string, GroupLook>;
}

export const readFarPalette = (layer: HTMLElement): FarPalette => {
    const css = (element: Element | null) => (element ? getComputedStyle(element) : null);
    const layerStyle = getComputedStyle(layer);
    const muted = css(layer.querySelector('.wg-count'))?.color ?? layerStyle.color;
    const nodeStyle = (selector: string, fallback: FarPalette['node']['plain'] | null) => {
        const style = css(layer.querySelector(selector));
        if (!style) return fallback ?? { fill: layerStyle.backgroundColor, stroke: muted, alpha: 1, dashed: false };
        return {
            fill: style.backgroundColor,
            stroke: style.borderLeftColor,
            alpha: Number(style.opacity) || 1,
            dashed: style.borderLeftStyle === 'dashed',
        };
    };
    // Notes have their own colours in the HTML, so they never stand in for the other looks.
    const plain = nodeStyle('.wg-node:not(.reroute):not(.bypass):not(.mute):not(.note)', null);
    const wire: FarPalette['wire'] = {};
    layer.querySelectorAll<SVGPathElement>('.wg-wire').forEach((path) => {
        const type = /\bt-([a-z]+)\b/.exec(path.getAttribute('class') ?? '')?.[1] as WireType | undefined;
        if (type && !wire[type]) wire[type] = getComputedStyle(path).stroke;
    });
    const group = new Map<string, GroupLook>();
    layer.querySelectorAll<HTMLElement>('.wg-group[data-group-key]').forEach((element) => {
        const key = element.dataset.groupKey ?? '';
        const style = getComputedStyle(element);
        // An open group's title is on its tab or chip; a folded group's is inside its box.
        const tab = Array.from(layer.querySelectorAll<HTMLElement>('.wg-gtitle[data-group-key]')).find(
            (candidate) => candidate.dataset.groupKey === key
        );
        const tabStyle = css(tab ?? null);
        group.set(key, {
            fill: style.backgroundColor,
            stroke: style.borderLeftColor,
            titleColour: css((tab ?? element).querySelector('.wg-gt'))?.color ?? layerStyle.color,
            tabFill: tabStyle?.backgroundColor ?? style.backgroundColor,
            tabStroke: tabStyle?.borderLeftColor ?? style.borderLeftColor,
        });
    });
    return {
        font: layerStyle.fontFamily,
        text: layerStyle.color,
        muted,
        node: {
            plain,
            bypass: nodeStyle('.wg-node.bypass:not(.note)', plain),
            mute: nodeStyle('.wg-node.mute:not(.note)', { ...plain, alpha: 0.45 }),
            reroute: nodeStyle('.wg-node.reroute', plain),
        },
        wire,
        group,
    };
};

/** Wires grow against the zoom up to a cap, as the HTML view did. */
const WIRE_WIDTH = 2.2;
const WIRE_SCALE_CAP = 2.4;
/** Node titles, in world units: this size at the switch, and never under MIN_NODE_TITLE_PX on screen. */
const LABEL_PX = 12 * 2.1;
const TYPE_RATIO = 0.72;
const LABEL_PAD = 10;
const MIN_NODE_TITLE_PX = 10;
/** Below this scale a node shows its title only, without its type. */
export const TYPE_LINE_SCALE = 0.35;
/** The HTML tab's title size in world units, which far mode starts from so titles do not jump at the switch. */
export const NEAR_GROUP_TITLE_PX = 13;
const OVERVIEW_WIRE_ALPHA = 0.4;
const OVERVIEW_TINT_ALPHA = 0.35;

/**
 * A group title's size on screen at scale s: the tab's size at the switch, growing as the view zooms out, to the cap.
 */
export const farGroupTitlePx = (s: number): number => Math.min(GROUP_TITLE_CAP_PX, (NEAR_GROUP_TITLE_PX * FAR_SCALE * FAR_SCALE) / s);

/** A node title's size in world units at scale s: at least MIN_NODE_TITLE_PX on screen, in whole steps. */
export const nodeTitleWorldPx = (s: number): number => Math.max(LABEL_PX, Math.ceil(MIN_NODE_TITLE_PX / s));

interface Label {
    text: string;
    x: number;
    y: number;
    anchor: boolean;
}

interface NodeLabels {
    titles: Label[];
    types: Label[];
    /** Where the titles sit, which a group title chip avoids when nodes fill its band. */
    texts: Rect[];
}

/** A group's title as drawn this frame: world rect, text and size on screen. */
export interface GroupLabel {
    key: string;
    kind: 'tab' | 'chip' | 'inside';
    rect: Rect;
    area: number;
    text: string;
    count: string | null;
    px: number;
}

/** The far scene turned into paths once, so a frame only replays them. Node titles are fitted once per size. */
export interface FarDrawing {
    groups: (FarGroup & GroupLook & { path: Path2D })[];
    wires: { path: Path2D; colour: string; bypassed: boolean }[];
    nodes: { path: Path2D; fill: string; stroke: string; alpha: number; dashed: boolean }[];
    tints: { path: Path2D; colour: string }[];
    boxes: Rect[];
    sceneNodes: FarNode[];
    labels: Map<number, NodeLabels>;
    font: string;
    text: string;
    muted: string;
}

const canvasMeasure =
    (ctx: CanvasRenderingContext2D, font: string, weight: number): Measure =>
    (text, px) => {
        ctx.font = `${weight} ${px}px ${font}`;
        return ctx.measureText(text).width;
    };

export const prepareFarDrawing = (scene: FarScene, palette: FarPalette): FarDrawing => {
    const groups = scene.groups.flatMap((group) => {
        const look = palette.group.get(group.key);
        if (!look) return [];
        const path = new Path2D();
        path.roundRect(group.x, group.y, group.w, group.h, 10);
        return [{ ...group, ...look, path }];
    });

    const wireRuns = new Map<string, { d: string[]; colour: string; bypassed: boolean }>();
    for (const wire of scene.wires) {
        const colour = palette.wire[wire.type] ?? palette.muted;
        const key = `${colour}|${wire.bypassed}`;
        const run = wireRuns.get(key) ?? { d: [], colour, bypassed: wire.bypassed };
        run.d.push(wire.d);
        wireRuns.set(key, run);
    }

    const nodePaths = new Map<FarNode['variant'], Path2D>();
    const tintPaths = new Map<string, Path2D>();
    for (const node of scene.nodes) {
        const radius = node.variant === 'reroute' ? node.h / 2 : 8;
        let path = nodePaths.get(node.variant);
        if (!path) {
            path = new Path2D();
            nodePaths.set(node.variant, path);
        }
        path.roundRect(node.x, node.y, node.w, node.h, radius);
        if (node.group !== null && node.variant !== 'reroute') {
            let tint = tintPaths.get(node.group);
            if (!tint) {
                tint = new Path2D();
                tintPaths.set(node.group, tint);
            }
            tint.roundRect(node.x, node.y, node.w, node.h, radius);
        }
    }

    return {
        groups,
        wires: [...wireRuns.values()].map((run) => ({ path: new Path2D(run.d.join(' ')), colour: run.colour, bypassed: run.bypassed })),
        nodes: [...nodePaths].map(([variant, path]) => ({ path, ...palette.node[variant] })),
        tints: [...tintPaths].flatMap(([key, path]) => {
            const look = palette.group.get(key);
            return look ? [{ path, colour: look.stroke }] : [];
        }),
        boxes: scene.nodes.map(({ x, y, w, h }) => ({ x, y, w, h })),
        sceneNodes: scene.nodes,
        labels: new Map(),
        font: palette.font,
        text: palette.text,
        muted: palette.muted,
    };
};

/** Node titles fitted at one size, built the first time the view reaches it. */
const nodeLabelsAt = (ctx: CanvasRenderingContext2D, drawing: FarDrawing, px: number): NodeLabels => {
    const cached = drawing.labels.get(px);
    if (cached) return cached;
    const typePx = px * TYPE_RATIO;
    const bold = canvasMeasure(ctx, drawing.font, 700);
    const plain = canvasMeasure(ctx, drawing.font, 500);
    const labels: NodeLabels = { titles: [], types: [], texts: [] };
    for (const node of drawing.sceneNodes) {
        if (node.variant === 'reroute' || node.h < px) continue;
        // Centred: the title, and the node type below it when it differs and fits.
        const width = node.w - LABEL_PAD * 2;
        const cx = node.x + node.w / 2;
        const withType = node.nodeType !== null && node.h >= px + typePx * 1.6;
        const cy = node.y + node.h / 2 - (withType ? typePx * 0.7 : 0);
        const title = fitText(bold, node.title, px, width);
        if (title && keepsEnough(title, node.title)) {
            labels.titles.push({ text: title, x: cx, y: cy, anchor: node.anchor });
            labels.texts.push({ x: node.x, y: cy - px * 0.6, w: node.w, h: px * 1.2 });
        }
        if (withType && node.nodeType) {
            const type = fitText(plain, node.nodeType, typePx, width);
            if (type && keepsEnough(type, node.nodeType))
                labels.types.push({ text: type, x: cx, y: cy + px * 0.6 + typePx * 0.8, anchor: node.anchor });
        }
    }
    drawing.labels.set(px, labels);
    return labels;
};

/**
 * Every group title for this frame. Sizes are on screen and rects in the world. A tab or chip is as high as its
 * text needs; the overview drops default and overlapping titles and shows no node counts.
 */
export const layoutGroupLabels = (
    drawing: { groups: readonly FarGroup[]; boxes: readonly Rect[] },
    s: number,
    level: Exclude<ViewLevel, 'near'>,
    measure: Measure,
    texts: readonly Rect[]
): GroupLabel[] => {
    const px = farGroupTitlePx(s);
    const countPx = px * (11 / NEAR_GROUP_TITLE_PX);
    const hScreen = px * (GROUP_TAB_H / NEAR_GROUP_TITLE_PX);
    const padScreen = px * 0.6;
    const inset = 6 / s;
    const labels: GroupLabel[] = [];
    for (const group of drawing.groups) {
        const room = group.w * s - padScreen * 2;
        let text: string;
        let size = px;
        let count: string | null = null;
        if (level === 'overview') {
            const fitted = fitOverviewTitle(measure, group.title, px, room - inset * s * 2);
            if (!fitted) continue;
            text = fitted.text;
            size = fitted.px;
        } else {
            const countText = group.count === 1 ? '1 node' : `${group.count} nodes`;
            const countW = measure(countText, countPx) + padScreen;
            text = fitText(measure, group.title, px, room - (group.shut ? 0 : countW));
            if (!text) continue;
            if (!group.shut) count = countText;
        }
        const width = padScreen * 2 + measure(text, size) + (count ? padScreen + measure(count, countPx) : 0);
        const area = group.w * group.h;
        if (group.shut) {
            const rect = { x: group.x + 12 / s - padScreen / s, y: group.y + (group.h - hScreen / s) / 2, w: width / s, h: hScreen / s };
            labels.push({ key: group.key, kind: 'inside', rect, area, text, count: null, px: size });
            continue;
        }
        const slot = placeGroupTitle(group, width / s, hScreen / s, drawing.boxes, texts, inset);
        labels.push({ key: group.key, kind: slot.kind, rect: slot, area, text, count, px: size });
    }
    return level === 'overview' ? dropOverlaps(labels) : labels;
};

/** Paints the far drawing over the whole canvas, in the view's pan and zoom; `dpr` is the canvas's pixel ratio. */
export const drawFarScene = (
    ctx: CanvasRenderingContext2D,
    drawing: FarDrawing,
    view: View,
    dpr: number,
    level: Exclude<ViewLevel, 'near'> = 'far'
) => {
    const { x, y, s } = view;
    const inv = 1 / s;
    const overview = level === 'overview';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * x, dpr * y);

    // The HTML view's stacking order: wires, groups, title tabs, nodes, then title chips over the nodes.
    const wireWidth = WIRE_WIDTH * Math.min(inv, WIRE_SCALE_CAP);
    ctx.lineCap = 'round';
    ctx.lineWidth = wireWidth;
    ctx.globalAlpha = overview ? OVERVIEW_WIRE_ALPHA : 1;
    for (const wire of drawing.wires) {
        ctx.strokeStyle = wire.colour;
        ctx.setLineDash(wire.bypassed ? [(6 / 2.2) * wireWidth, (5 / 2.2) * wireWidth] : []);
        ctx.stroke(wire.path);
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    ctx.lineWidth = inv;
    for (const group of drawing.groups) {
        ctx.fillStyle = group.fill;
        ctx.fill(group.path);
        ctx.strokeStyle = group.stroke;
        ctx.stroke(group.path);
    }

    const nodeLabels = overview ? null : nodeLabelsAt(ctx, drawing, nodeTitleWorldPx(s));
    const bold = canvasMeasure(ctx, drawing.font, 700);
    const groupLabels = layoutGroupLabels(drawing, s, level, bold, nodeLabels?.texts ?? []);
    const looks = new Map(drawing.groups.map((group) => [group.key, group]));
    const paintGroupLabel = (label: GroupLabel) => {
        const look = looks.get(label.key);
        if (!look) return;
        const { rect } = label;
        if (label.kind !== 'inside') {
            const backing = new Path2D();
            const r = 7 * inv;
            backing.roundRect(rect.x, rect.y, rect.w, rect.h, label.kind === 'tab' ? [r, r, 0, 0] : r);
            ctx.fillStyle = look.tabFill;
            ctx.fill(backing);
            ctx.strokeStyle = look.tabStroke;
            ctx.stroke(backing);
        }
        const pad = label.px * 0.6 * inv;
        const mid = rect.y + rect.h / 2;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = look.titleColour;
        ctx.font = `700 ${label.px * inv}px ${drawing.font}`;
        ctx.fillText(label.text, rect.x + pad, mid);
        if (label.count) {
            const after = rect.x + pad * 2 + ctx.measureText(label.text).width;
            ctx.fillStyle = drawing.muted;
            ctx.font = `500 ${label.px * (11 / NEAR_GROUP_TITLE_PX) * inv}px ${drawing.font}`;
            ctx.fillText(label.count, after, mid);
        }
    };
    for (const label of groupLabels) if (label.kind !== 'chip') paintGroupLabel(label);

    // The overview draws nodes as soft shapes tinted toward their group's colour, without borders.
    for (const look of drawing.nodes) {
        ctx.globalAlpha = look.alpha;
        ctx.fillStyle = look.fill;
        ctx.fill(look.path);
        if (overview) continue;
        ctx.strokeStyle = look.stroke;
        ctx.setLineDash(look.dashed ? [4 * inv, 3 * inv] : []);
        ctx.stroke(look.path);
    }
    ctx.setLineDash([]);
    if (overview) {
        ctx.globalAlpha = OVERVIEW_TINT_ALPHA;
        for (const tint of drawing.tints) {
            ctx.fillStyle = tint.colour;
            ctx.fill(tint.path);
        }
    }
    ctx.globalAlpha = 1;

    // Node titles in far mode; in the overview, only the selected outputs keep theirs.
    const titlePx = nodeTitleWorldPx(s);
    const shownLabels = nodeLabels ?? nodeLabelsAt(ctx, drawing, titlePx);
    const keep = (label: Label) => !overview || label.anchor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = drawing.text;
    ctx.font = `700 ${titlePx}px ${drawing.font}`;
    for (const label of shownLabels.titles) if (keep(label)) ctx.fillText(label.text, label.x, label.y);
    if (s >= TYPE_LINE_SCALE) {
        ctx.fillStyle = drawing.muted;
        ctx.font = `500 ${titlePx * TYPE_RATIO}px ${drawing.font}`;
        for (const label of shownLabels.types) if (keep(label)) ctx.fillText(label.text, label.x, label.y);
    }

    for (const label of groupLabels) if (label.kind === 'chip') paintGroupLabel(label);
};

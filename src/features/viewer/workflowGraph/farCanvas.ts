import { DOOR_H, type GraphModel, type Positions, type WireType } from './graphModel';
import {
    FAR_SCALE,
    GROUP_TITLE_H,
    groupBox,
    nodeHeight,
    type Rect,
    type Scene,
    type View,
    type ViewLevel,
    type WirePath,
} from './geometry';
import {
    countFits,
    dropOverlaps,
    fitOverviewTitle,
    fitText,
    GROUP_TITLE_CAP_PX,
    keepsEnough,
    OVERVIEW_TITLE_MIN_PX,
    pillClear,
    TITLE_CHROME,
    TITLE_INSET,
    placeGroupTitle,
    type Measure,
} from './groupTitles';
import { ARRIVE_STEPS, arrived, arriveStep, GROUP_ARRIVE_MS, NODE_ARRIVE_MS, WIRE_DRAW_MS, wireDelay, type EntrancePlan } from './entrance';

/**
 * Far mode draws the graph on one canvas instead of thousands of HTML elements, so a pan or zoom step
 * re-rasters a few hundred shapes. It is presentation only: the boxes and wires come from the same model,
 * positions, folds and wire paths the HTML view draws. It has two levels, the owner's ladder below the near view's
 * full detail: far, with group titles and node titles, and the overview, where group titles are the only text.
 */

export interface FarNode extends Rect {
    id: string;
    title: string;
    variant: 'plain' | 'bypass' | 'mute' | 'reroute';
    /** A subgraph instance with its open row showing, which the canvas marks with the same band. */
    door: boolean;
    /** The innermost open group the node belongs to, whose colour tints it in the overview. */
    group: string | null;
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
    laidOut: ReadonlyMap<string, number> = new Map()
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
                    variant,
                    door: node.kind === 'subgraph' && node.inside !== null && !folded,
                    group: innermost.get(node.id) ?? null,
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
    pillFill: string;
    pillStroke: string;
}

/** Colours and font, read from the rendered HTML so the token file stays their only source. */
export interface FarPalette {
    font: string;
    text: string;
    muted: string;
    /** The selection colour, for the rings round picked, focused and found nodes. */
    accent: string;
    node: Record<FarNode['variant'], { fill: string; stroke: string; alpha: number; dashed: boolean }>;
    wire: Partial<Record<WireType, string>>;
    /** The near view's wire width at 100%, from the Wires menu. */
    wireWidth: number;
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
        // An open group's title is on its pill; a folded group's is inside its box.
        const pill = Array.from(layer.querySelectorAll<HTMLElement>('.wg-gtitle[data-group-key]')).find(
            (candidate) => candidate.dataset.groupKey === key
        );
        const pillStyle = css(pill ?? null);
        group.set(key, {
            fill: style.backgroundColor,
            stroke: style.borderLeftColor,
            titleColour: css((pill ?? element).querySelector('.wg-gt'))?.color ?? layerStyle.color,
            pillFill: pillStyle?.backgroundColor ?? style.backgroundColor,
            pillStroke: pillStyle?.borderLeftColor ?? style.borderLeftColor,
        });
    });
    return {
        font: layerStyle.fontFamily,
        text: layerStyle.color,
        muted,
        accent: layerStyle.getPropertyValue('--graph-sage').trim() || layerStyle.color,
        node: {
            plain,
            bypass: nodeStyle('.wg-node.bypass:not(.note)', plain),
            mute: nodeStyle('.wg-node.mute:not(.note)', { ...plain, alpha: 0.45 }),
            reroute: nodeStyle('.wg-node.reroute', plain),
        },
        wire,
        wireWidth: parseFloat(layerStyle.getPropertyValue('--wg-ww')) || WIRE_WIDTH,
        group,
    };
};

/** Wires grow against the zoom up to a cap, as the HTML view did. */
const WIRE_WIDTH = 2.2;
const WIRE_SCALE_CAP = 2.4;
/**
 * Node titles, in world units: 11 px on screen at the switch, and never under MIN_NODE_TITLE_PX. They sit a step
 * below the group pills (smaller, lighter and muted), so the groups read first.
 */
const LABEL_PX = 11 / FAR_SCALE;
const LABEL_PAD = 10;
const MIN_NODE_TITLE_PX = 10;
const NODE_TITLE_WEIGHT = 600;
/** The open row's band: its HTML height, at least DOOR_MIN_PX on screen, and never more than DOOR_MAX_SHARE of the box. */
const DOOR_MIN_PX = 4;
const DOOR_MAX_SHARE = 0.4;
const DOOR_ALPHA = 0.3;
/** Node borders are drawn fainter than in the HTML, so the boxes stay behind the group areas. */
const NODE_STROKE_ALPHA = 0.6;
/** The HTML pill's title size in world units, which far mode starts from so titles do not jump at the switch. */
export const NEAR_GROUP_TITLE_PX = 13;
/** A pill's node count against its title, as in the HTML (11 px beside 13 px). */
const COUNT_RATIO = 11 / NEAR_GROUP_TITLE_PX;
/** A pill's height against its title size, as in the HTML. */
const PILL_H_RATIO = GROUP_TITLE_H / NEAR_GROUP_TITLE_PX;
const OVERVIEW_WIRE_ALPHA = 0.4;
const OVERVIEW_TINT_ALPHA = 0.35;

/**
 * A group title's size on screen at scale s: the pill's size at the switch, growing as the view zooms out, to the cap.
 */
export const farGroupTitlePx = (s: number): number => Math.min(GROUP_TITLE_CAP_PX, (NEAR_GROUP_TITLE_PX * FAR_SCALE * FAR_SCALE) / s);

/**
 * A node title's size in world units at scale s: at least MIN_NODE_TITLE_PX on screen, in quarter-octave steps, so a
 * zoom sweep fits the titles at a few sizes instead of one per step.
 */
export const nodeTitleWorldPx = (s: number): number => {
    const needed = MIN_NODE_TITLE_PX / s;
    if (needed <= LABEL_PX) return LABEL_PX;
    return LABEL_PX * 2 ** (Math.ceil(Math.log2(needed / LABEL_PX) * 4) / 4);
};

interface Label {
    text: string;
    x: number;
    y: number;
}

/** A group's title as drawn this frame: world rect, text and size on screen. */
export interface GroupLabel {
    key: string;
    kind: 'pill' | 'inside';
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
    /** Subgraph instances whose open row the canvas draws as a band. */
    doors: FarNode[];
    sceneNodes: FarNode[];
    /** Fitted node titles by size. */
    labels: Map<number, Label[]>;
    font: string;
    text: string;
    muted: string;
    accent: string;
    wireWidth: number;
}

/** The nodes the view marks on the far canvas: the one in the side panel, the arrow keys' one, a search's hits. */
export interface FarMarks {
    selected: string | null;
    cursor: string | null;
    hits: ReadonlySet<string> | null;
}

export const NO_FAR_MARKS: FarMarks = { selected: null, cursor: null, hits: null };

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
        doors: scene.nodes.filter((node) => node.door),
        sceneNodes: scene.nodes,
        labels: new Map(),
        font: palette.font,
        text: palette.text,
        muted: palette.muted,
        accent: palette.accent,
        wireWidth: palette.wireWidth,
    };
};

/** Node titles fitted at one size, centred in their nodes, built the first time the view reaches that size. */
const nodeLabelsAt = (ctx: CanvasRenderingContext2D, drawing: FarDrawing, px: number): Label[] => {
    const cached = drawing.labels.get(px);
    if (cached) return cached;
    const measure = canvasMeasure(ctx, drawing.font, NODE_TITLE_WEIGHT);
    const labels: Label[] = [];
    for (const node of drawing.sceneNodes) {
        if (node.variant === 'reroute' || node.h < px) continue;
        const title = fitText(measure, node.title, px, node.w - LABEL_PAD * 2);
        if (title && keepsEnough(title, node.title)) labels.push({ text: title, x: node.x + node.w / 2, y: node.y + node.h / 2 });
    }
    drawing.labels.set(px, labels);
    return labels;
};

const nodeCount = (count: number) => (count === 1 ? '1 node' : `${count} nodes`);

/**
 * Every group title for this frame. Sizes are on screen and rects in the world. Each pill sits at its group's
 * top-left. An open group's far pill is the near pill scaled up as the view zooms out, so at the switch it is the
 * near pill exactly. The overview shrinks titles to fit, drops overlapping ones, and adds the node count after a
 * whole title where it fits: that count is what tells apart groups that all kept ComfyUI's default name.
 */
export const layoutGroupLabels = (
    drawing: { groups: readonly FarGroup[] },
    s: number,
    level: Exclude<ViewLevel, 'near'>,
    measure: Measure,
    plain: Measure = measure
): GroupLabel[] => {
    const px = farGroupTitlePx(s);
    const hScreen = px * PILL_H_RATIO;
    const padScreen = px * 0.6;
    const inset = 6 / s;
    // World units per near-pill unit: 1 at the switch, growing as the view zooms out.
    const k = px / (NEAR_GROUP_TITLE_PX * s);
    const labels: GroupLabel[] = [];
    for (const group of drawing.groups) {
        const area = group.w * group.h;
        const countText = nodeCount(group.count);
        if (level === 'far' && !group.shut) {
            const titleW = measure(group.title, NEAR_GROUP_TITLE_PX);
            const countW = plain(countText, 11);
            const textRoom = group.w / k - 2 * TITLE_INSET - TITLE_CHROME;
            const withCount = countFits(titleW, countW, textRoom);
            const text = fitText(measure, group.title, NEAR_GROUP_TITLE_PX, textRoom - (withCount ? countW : 0));
            if (!text) continue;
            const width = k * (titleW + TITLE_CHROME + (withCount ? countW : 0));
            const rect = placeGroupTitle(group, width, k * GROUP_TITLE_H, k * TITLE_INSET);
            if (!pillClear(rect, group, drawing.groups)) continue;
            labels.push({ key: group.key, kind: 'pill', rect, area, text, count: withCount ? countText : null, px });
            continue;
        }
        const room = group.w * s - padScreen * 2;
        let text: string;
        let size = px;
        let count: string | null = null;
        let countW = 0;
        if (level === 'overview') {
            const textRoom = room - inset * s * 2;
            const fitted = fitOverviewTitle(measure, group.title, px, textRoom);
            if (!fitted) continue;
            text = fitted.text;
            size = fitted.px;
            // The count goes after the gap the pill paints it at: one more padding.
            const withGap = size * 0.6 + plain(countText, size * COUNT_RATIO);
            if (!group.shut && text === group.title && countFits(measure(text, size), withGap, textRoom)) {
                count = countText;
                countW = withGap;
            }
        } else {
            text = fitText(measure, group.title, px, room);
            if (!text) continue;
        }
        const width = padScreen * 2 + measure(text, size) + countW;
        if (group.shut) {
            const rect = { x: group.x + 12 / s - padScreen / s, y: group.y + (group.h - hScreen / s) / 2, w: width / s, h: hScreen / s };
            labels.push({ key: group.key, kind: 'inside', rect, area, text, count: null, px: size });
            continue;
        }
        if (level === 'overview') {
            // A pill too big for its group, or running over another, shrinks to the floor; if that still does not
            // fit, the group goes without a title.
            const pillAt = (title: string, px: number, countRoom: number) =>
                placeGroupTitle(group, (px * 1.2 + measure(title, px) + countRoom) / s, (px * PILL_H_RATIO) / s, inset);
            let slot = pillAt(text, size, countW);
            if (!pillClear(slot, group, drawing.groups)) {
                if (size <= OVERVIEW_TITLE_MIN_PX) continue;
                size = OVERVIEW_TITLE_MIN_PX;
                text = fitText(measure, group.title, size, room - inset * s * 2);
                if (!text || !keepsEnough(text, group.title)) continue;
                count = null;
                slot = pillAt(text, size, 0);
                if (!pillClear(slot, group, drawing.groups)) continue;
            }
            labels.push({ key: group.key, kind: 'pill', rect: slot, area, text, count, px: size });
            continue;
        }
        const slot = placeGroupTitle(group, width / s, hScreen / s, inset);
        if (!pillClear(slot, group, drawing.groups)) continue;
        labels.push({ key: group.key, kind: 'pill', rect: slot, area, text, count, px: size });
    }
    return level === 'overview' ? dropOverlaps(labels) : labels;
};

/** The group whose title pill is under a world point, of the pills drawn last; a click there zooms to the group. */
export const groupPillAt = (pills: readonly GroupLabel[], x: number, y: number): string | null =>
    pills.find(({ rect }) => x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h)?.key ?? null;

/** The node under a world point: the last one drawn wins, as it is on top. */
export const farNodeAt = (nodes: readonly FarNode[], x: number, y: number): string | null => {
    for (let index = nodes.length - 1; index >= 0; index--) {
        const node = nodes[index];
        if (x >= node.x && x <= node.x + node.w && y >= node.y && y <= node.y + node.h) return node.id;
    }
    return null;
};

/**
 * Rings drawn over the nodes: a search's hits, then the picked node, then the arrow keys' node outside it. `alpha`
 * is the nodes' own, so during the entrance a ring fades in with its node.
 */
const paintMarks = (ctx: CanvasRenderingContext2D, drawing: FarDrawing, marks: FarMarks, inv: number, alpha: number) => {
    if (!marks.hits && marks.selected === null && marks.cursor === null) return;
    const ring = (node: FarNode, gap: number, width: number) => {
        const path = new Path2D();
        path.roundRect(node.x - gap * inv, node.y - gap * inv, node.w + 2 * gap * inv, node.h + 2 * gap * inv, 8 + gap * inv);
        ctx.lineWidth = width * inv;
        ctx.stroke(path);
    };
    ctx.strokeStyle = drawing.accent;
    for (const node of drawing.sceneNodes) {
        if (marks.hits?.has(node.id)) {
            ctx.globalAlpha = 0.7 * alpha;
            ring(node, 2, 2);
        }
        if (node.id === marks.selected) {
            ctx.globalAlpha = alpha;
            ring(node, 1, 2);
        }
        if (node.id === marks.cursor) {
            ctx.globalAlpha = alpha;
            ctx.setLineDash([4 * inv, 3 * inv]);
            ring(node, 5, 2);
            ctx.setLineDash([]);
        }
    }
    ctx.globalAlpha = 1;
};

/**
 * The far canvas's entrance: the nodes and wires split into a few steps by when they arrive, each step drawn as its
 * own small drawing with one opacity, so a frame of it costs about one plain draw.
 */
export interface FarArrival {
    nodes: { delay: number; drawing: FarDrawing }[];
    wires: { delay: number; drawing: FarDrawing }[];
}

export const prepareFarArrival = (scene: FarScene, palette: FarPalette, plan: EntrancePlan): FarArrival => {
    const span = Math.max(0, ...plan.nodeDelay.values());
    const nodeSteps = Array.from({ length: ARRIVE_STEPS }, () => ({ delay: 0, nodes: [] as FarNode[] }));
    for (const node of scene.nodes) {
        const { step, delay } = arriveStep(plan.nodeDelay.get(node.id) ?? 0, span);
        nodeSteps[step].delay = delay;
        nodeSteps[step].nodes.push(node);
    }
    // A wire starts after the later of its ends, plus a lag; the steps keep that lag.
    const lag = wireDelay(plan, { from: '', to: '' });
    const wireSteps = Array.from({ length: ARRIVE_STEPS }, () => ({ delay: 0, wires: [] as WirePath[] }));
    for (const wire of scene.wires) {
        const { step, delay } = arriveStep(wireDelay(plan, wire) - lag, span);
        wireSteps[step].delay = delay + lag;
        wireSteps[step].wires.push(wire);
    }
    return {
        nodes: nodeSteps
            .filter((step) => step.nodes.length > 0)
            .map((step) => ({ delay: step.delay, drawing: prepareFarDrawing({ groups: [], nodes: step.nodes, wires: [] }, palette) })),
        wires: wireSteps
            .filter((step) => step.wires.length > 0)
            .map((step) => ({ delay: step.delay, drawing: prepareFarDrawing({ groups: [], nodes: [], wires: step.wires }, palette) })),
    };
};

/**
 * Paints the far drawing over the whole canvas, in the view's pan and zoom; `dpr` is the canvas's pixel ratio. The
 * pill of the `hover` group gets the near pill's hover border. During the entrance, `arrival` and its time `t` (ms
 * since it started) draw the nodes and wires step by step instead. Returns the title pills it drew, for hit-testing.
 */
export const drawFarScene = (
    ctx: CanvasRenderingContext2D,
    drawing: FarDrawing,
    view: View,
    dpr: number,
    level: Exclude<ViewLevel, 'near'> = 'far',
    hover: string | null = null,
    marks: FarMarks = NO_FAR_MARKS,
    arrival: { steps: FarArrival; t: number } | null = null
): GroupLabel[] => {
    const { x, y, s } = view;
    const inv = 1 / s;
    const overview = level === 'overview';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * x, dpr * y);

    // The HTML view's stacking order: wires, groups, nodes, then title pills over the nodes.
    const wireWidth = drawing.wireWidth * Math.min(inv, WIRE_SCALE_CAP);
    ctx.lineCap = 'round';
    ctx.lineWidth = wireWidth;
    const wireLayers = arrival
        ? arrival.steps.wires.map((step) => ({ drawing: step.drawing, alpha: arrived(arrival.t, step.delay, WIRE_DRAW_MS) }))
        : [{ drawing, alpha: 1 }];
    const nodeLayers = arrival
        ? arrival.steps.nodes.map((step) => ({ drawing: step.drawing, alpha: arrived(arrival.t, step.delay, NODE_ARRIVE_MS) }))
        : [{ drawing, alpha: 1 }];
    const groupAlpha = arrival ? arrived(arrival.t, 0, GROUP_ARRIVE_MS) : 1;
    for (const layer of wireLayers) {
        ctx.globalAlpha = (overview ? OVERVIEW_WIRE_ALPHA : 1) * layer.alpha;
        for (const wire of layer.drawing.wires) {
            ctx.strokeStyle = wire.colour;
            ctx.setLineDash(wire.bypassed ? [(6 / WIRE_WIDTH) * wireWidth, (5 / WIRE_WIDTH) * wireWidth] : []);
            ctx.stroke(wire.path);
        }
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = groupAlpha;

    ctx.lineWidth = inv;
    for (const group of drawing.groups) {
        ctx.fillStyle = group.fill;
        ctx.fill(group.path);
        ctx.strokeStyle = group.stroke;
        ctx.stroke(group.path);
    }

    const titlePx = nodeTitleWorldPx(s);
    const bold = canvasMeasure(ctx, drawing.font, 700);
    const groupLabels = layoutGroupLabels(drawing, s, level, bold, canvasMeasure(ctx, drawing.font, 500));
    const looks = new Map(drawing.groups.map((group) => [group.key, group]));
    const paintGroupLabel = (label: GroupLabel) => {
        const look = looks.get(label.key);
        if (!look) return;
        const { rect } = label;
        if (label.kind !== 'inside') {
            const backing = new Path2D();
            backing.roundRect(rect.x, rect.y, rect.w, rect.h, 7 * inv);
            ctx.fillStyle = look.pillFill;
            ctx.fill(backing);
            ctx.strokeStyle = label.key === hover ? look.titleColour : look.pillStroke;
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
            ctx.font = `500 ${label.px * COUNT_RATIO * inv}px ${drawing.font}`;
            ctx.fillText(label.count, after, mid);
        }
    };
    for (const label of groupLabels) if (label.kind === 'inside') paintGroupLabel(label);

    ctx.globalAlpha = 1;

    for (const layer of nodeLayers) {
        if (layer.alpha <= 0) continue;
        // The overview draws nodes as soft shapes tinted toward their group's colour, without borders.
        for (const look of layer.drawing.nodes) {
            ctx.globalAlpha = look.alpha * layer.alpha;
            ctx.fillStyle = look.fill;
            ctx.fill(look.path);
            if (overview) continue;
            ctx.globalAlpha = look.alpha * NODE_STROKE_ALPHA * layer.alpha;
            ctx.strokeStyle = look.stroke;
            ctx.setLineDash(look.dashed ? [4 * inv, 3 * inv] : []);
            ctx.stroke(look.path);
        }
        ctx.setLineDash([]);
        if (overview) {
            ctx.globalAlpha = OVERVIEW_TINT_ALPHA * layer.alpha;
            for (const tint of layer.drawing.tints) {
                ctx.fillStyle = tint.colour;
                ctx.fill(tint.path);
            }
        }
        // The open row of a subgraph instance, at every far level, so a door reads as one before it is readable.
        if (layer.drawing.doors.length > 0) {
            ctx.globalAlpha = DOOR_ALPHA * layer.alpha;
            ctx.fillStyle = drawing.accent;
            const band = new Path2D();
            for (const node of layer.drawing.doors) {
                const h = Math.min(Math.max(DOOR_H, DOOR_MIN_PX * inv), node.h * DOOR_MAX_SHARE);
                band.roundRect(node.x, node.y + node.h - h, node.w, h, [0, 0, 8, 8]);
            }
            ctx.fill(band);
        }
        // Node titles in far mode only; the overview's only text is the group titles.
        if (!overview) {
            ctx.globalAlpha = layer.alpha;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = drawing.muted;
            ctx.font = `${NODE_TITLE_WEIGHT} ${titlePx}px ${drawing.font}`;
            for (const label of nodeLabelsAt(ctx, layer.drawing, titlePx)) ctx.fillText(label.text, label.x, label.y);
        }
    }
    ctx.globalAlpha = 1;

    for (const layer of nodeLayers) paintMarks(ctx, layer.drawing, marks, inv, layer.alpha);

    ctx.globalAlpha = groupAlpha;
    const pills = groupLabels.filter((label) => label.kind === 'pill');
    for (const label of pills) paintGroupLabel(label);
    ctx.globalAlpha = 1;
    return pills;
};

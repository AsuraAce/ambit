import type { GraphModel, Positions, WireType } from './graphModel';
import { groupBox, nodeHeight, type Rect, type Scene, type View, type WirePath } from './geometry';

/**
 * Far mode draws the graph on one canvas instead of thousands of HTML elements, so a pan or zoom step
 * re-rasters a few hundred shapes. It is presentation only: the boxes and wires come from the same model,
 * positions, folds and wire paths the HTML view draws, and the switch happens at the same FAR_SCALE.
 */

export interface FarNode extends Rect {
    id: string;
    title: string;
    nodeType: string | null;
    variant: 'plain' | 'bypass' | 'mute' | 'reroute';
}

export interface FarGroup extends Rect {
    key: string;
    title: string;
    shut: boolean;
}

export interface FarScene {
    groups: FarGroup[];
    nodes: FarNode[];
    wires: WirePath[];
}

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
): FarScene => ({
    groups: model.groups
        .filter((group) => !scene.hiddenGroups.has(group.key))
        .map((group) => {
            const shut = foldedGroups.has(group.key);
            return { key: group.key, title: group.title, shut, ...groupBox(group, shut) };
        }),
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
                x: at.x,
                y: at.y,
                w: node.width,
                h,
            },
        ];
    }),
    wires,
});

/** Colours and font, read from the rendered HTML so the token file stays their only source. */
export interface FarPalette {
    font: string;
    text: string;
    muted: string;
    node: Record<FarNode['variant'], { fill: string; stroke: string; alpha: number; dashed: boolean }>;
    wire: Partial<Record<WireType, string>>;
    group: Map<string, { fill: string; stroke: string; title: string }>;
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
    const group = new Map<string, { fill: string; stroke: string; title: string }>();
    layer.querySelectorAll<HTMLElement>('.wg-group[data-group-key]').forEach((element) => {
        const style = getComputedStyle(element);
        group.set(element.dataset.groupKey ?? '', {
            fill: style.backgroundColor,
            stroke: style.borderLeftColor,
            title: css(element.querySelector('.wg-gt'))?.color ?? layerStyle.color,
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

/**
 * Wires and labels grow against the zoom up to a cap, as the HTML view did; group titles keep growing. Far mode
 * starts at a scale of 0.5, so labels are at their cap almost at once: they are laid out once at that size.
 */
const WIRE_WIDTH = 2.2;
const WIRE_SCALE_CAP = 2.4;
const LABEL_PX = 12 * 2.1;
const TYPE_PX = LABEL_PX * 0.72;
const LABEL_PAD = 10;
const GROUP_TITLE_PX = 15;

interface Label {
    text: string;
    x: number;
    y: number;
}

/** The far scene turned into paths and fitted labels once, so a frame only replays them. */
export interface FarDrawing {
    groups: { path: Path2D; fill: string; stroke: string; title: string; text: string; x: number; y: number; w: number; h: number }[];
    wires: { path: Path2D; colour: string; bypassed: boolean }[];
    nodes: { path: Path2D; fill: string; stroke: string; alpha: number; dashed: boolean }[];
    titles: Label[];
    types: Label[];
    font: string;
    text: string;
    muted: string;
}

/** Cuts text to fit a width, ending it with an ellipsis. */
const fitText = (ctx: CanvasRenderingContext2D, text: string, width: number) => {
    if (ctx.measureText(text).width <= width) return text;
    let low = 0;
    let high = text.length;
    while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (ctx.measureText(`${text.slice(0, mid)}…`).width <= width) low = mid;
        else high = mid - 1;
    }
    return low > 0 ? `${text.slice(0, low)}…` : '';
};

export const prepareFarDrawing = (ctx: CanvasRenderingContext2D, scene: FarScene, palette: FarPalette): FarDrawing => {
    const groups = scene.groups.flatMap((group) => {
        const colours = palette.group.get(group.key);
        if (!colours) return [];
        const path = new Path2D();
        path.roundRect(group.x, group.y, group.w, group.h, 10);
        return [{ path, ...colours, text: group.title, x: group.x, y: group.y, w: group.w, h: group.h }];
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
    const titles: Label[] = [];
    const types: Label[] = [];
    for (const node of scene.nodes) {
        let path = nodePaths.get(node.variant);
        if (!path) {
            path = new Path2D();
            nodePaths.set(node.variant, path);
        }
        path.roundRect(node.x, node.y, node.w, node.h, node.variant === 'reroute' ? node.h / 2 : 8);
        if (node.variant === 'reroute' || node.h < LABEL_PX) continue;
        // Centred like the HTML far label was: the title, and the node type below it when it differs and fits.
        const width = node.w - LABEL_PAD * 2;
        const cx = node.x + node.w / 2;
        const withType = node.nodeType !== null && node.h >= LABEL_PX + TYPE_PX * 1.6;
        const cy = node.y + node.h / 2 - (withType ? TYPE_PX * 0.7 : 0);
        ctx.font = `700 ${LABEL_PX}px ${palette.font}`;
        const title = fitText(ctx, node.title, width);
        if (title) titles.push({ text: title, x: cx, y: cy });
        if (withType && node.nodeType) {
            ctx.font = `500 ${TYPE_PX}px ${palette.font}`;
            const type = fitText(ctx, node.nodeType, width);
            if (type) types.push({ text: type, x: cx, y: cy + LABEL_PX * 0.6 + TYPE_PX * 0.8 });
        }
    }

    return {
        groups,
        wires: [...wireRuns.values()].map((run) => ({ path: new Path2D(run.d.join(' ')), colour: run.colour, bypassed: run.bypassed })),
        nodes: [...nodePaths].map(([variant, path]) => ({ path, ...palette.node[variant] })),
        titles,
        types,
        font: palette.font,
        text: palette.text,
        muted: palette.muted,
    };
};

/** Paints the far drawing over the whole canvas, in the view's pan and zoom; `dpr` is the canvas's pixel ratio. */
export const drawFarScene = (ctx: CanvasRenderingContext2D, drawing: FarDrawing, view: View, dpr: number) => {
    const { x, y, s } = view;
    const inv = 1 / s;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * x, dpr * y);

    // The HTML view's stacking order: wires, then groups with their titles, then nodes on top.
    const wireWidth = WIRE_WIDTH * Math.min(inv, WIRE_SCALE_CAP);
    ctx.lineCap = 'round';
    ctx.lineWidth = wireWidth;
    for (const wire of drawing.wires) {
        ctx.strokeStyle = wire.colour;
        ctx.setLineDash(wire.bypassed ? [(6 / 2.2) * wireWidth, (5 / 2.2) * wireWidth] : []);
        ctx.stroke(wire.path);
    }
    ctx.setLineDash([]);

    ctx.lineWidth = inv;
    for (const group of drawing.groups) {
        ctx.fillStyle = group.fill;
        ctx.fill(group.path);
        ctx.strokeStyle = group.stroke;
        ctx.stroke(group.path);
    }
    // Group titles grow without a cap, so they are fitted per frame; there are only a few.
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = `700 ${GROUP_TITLE_PX * inv}px ${drawing.font}`;
    for (const group of drawing.groups) {
        ctx.fillStyle = group.title;
        ctx.fillText(group.text, group.x + 12 * inv, group.y + 10 * inv, Math.max(0, group.w - 24 * inv));
    }

    for (const look of drawing.nodes) {
        ctx.globalAlpha = look.alpha;
        ctx.fillStyle = look.fill;
        ctx.fill(look.path);
        ctx.strokeStyle = look.stroke;
        ctx.setLineDash(look.dashed ? [4 * inv, 3 * inv] : []);
        ctx.stroke(look.path);
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = drawing.text;
    ctx.font = `700 ${LABEL_PX}px ${drawing.font}`;
    for (const label of drawing.titles) ctx.fillText(label.text, label.x, label.y);
    ctx.fillStyle = drawing.muted;
    ctx.font = `500 ${TYPE_PX}px ${drawing.font}`;
    for (const label of drawing.types) ctx.fillText(label.text, label.x, label.y);
};

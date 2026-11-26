import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    drawFarScene,
    farGroupTitlePx,
    farSceneFor,
    layoutGroupLabels,
    NEAR_GROUP_TITLE_PX,
    prepareFarDrawing,
    readFarPalette,
    type FarPalette,
} from '../farCanvas';
import { FAR_SCALE, groupBox, LOWEST_SCALE, OVERVIEW_SCALE, nodeHeight, sceneFor, wirePaths } from '../geometry';
import { GROUP_TITLE_CAP_PX, TITLE_CHROME, TITLE_INSET } from '../groupTitles';
import { buildGraphModel, savedPositions } from '../graphModel';
import { canvasGroup, canvasLink, canvasNode, level, port } from './canvasFixtures';

const model = buildGraphModel(
    level(
        [
            canvasNode('1', { title: 'Load', nodeType: 'CheckpointLoader', pos: { x: 20, y: 80 }, outputs: [port(0, 'LATENT')] }),
            canvasNode('2', { title: 'KSampler', pos: { x: 400, y: 80 }, inputs: [port(0, 'LATENT')], mode: 'bypassed' }),
            canvasNode('3', { title: 'Old', pos: { x: 400, y: 400 }, mode: 'muted' }),
            canvasNode('4', { kind: 'reroute', pos: { x: 700, y: 120 } }),
        ],
        [canvasLink('1', 0, '2', 0)],
        [canvasGroup('Loaders', 0, 0, 300, 300)]
    )
);
const positions = savedPositions(model);
const groupKey = model.groups[0].key;

const farScene = (foldedNodes: ReadonlySet<string>, foldedGroups: ReadonlySet<string>) => {
    const scene = sceneFor(model, 'saved', foldedGroups);
    const wires = wirePaths(model, positions, foldedNodes, scene, 'bundled');
    return { far: farSceneFor(model, positions, foldedNodes, foldedGroups, scene, wires), wires };
};

describe('farSceneFor', () => {
    // Far mode is presentation only: a box sits exactly where the HTML node does, at the height the view uses.
    it('draws every shown node at its position and height, with the same wires', () => {
        const folded = new Set(['3']);
        const { far, wires } = farScene(folded, new Set());
        expect(far.nodes.map((node) => node.id)).toEqual(['1', '2', '3', '4']);
        for (const box of far.nodes) {
            const node = model.nodes.find((candidate) => candidate.id === box.id)!;
            expect({ x: box.x, y: box.y, w: box.w, h: box.h }).toEqual({
                ...positions.get(box.id),
                w: node.width,
                h: nodeHeight(node, folded.has(node.id)),
            });
        }
        expect(far.wires).toBe(wires);
        expect(far.nodes.map((node) => node.variant)).toEqual(['plain', 'bypass', 'mute', 'reroute']);
    });

    // The HTML only sets a minimum height, so a node can lay out shorter than the model estimates.
    it('uses the laid-out height of a node when the view measured one', () => {
        const scene = sceneFor(model, 'saved', new Set());
        const far = farSceneFor(model, positions, new Set(), new Set(), scene, [], new Map([['2', 77]]));
        expect(far.nodes.find((node) => node.id === '2')?.h).toBe(77);
        expect(far.nodes.find((node) => node.id === '1')?.h).toBe(nodeHeight(model.nodes[0], false));
    });

    it('leaves out the members of a folded group and draws the group shut', () => {
        const { far } = farScene(new Set(), new Set([groupKey]));
        expect(far.nodes.map((node) => node.id)).toEqual(['2', '3', '4']);
        expect(far.groups).toEqual([{ key: groupKey, title: 'Loaders', count: 1, shut: true, ...groupBox(model.groups[0], true) }]);
    });

    // The overview tints each node toward its group.
    it('marks each node with its innermost open group', () => {
        const scene = sceneFor(model, 'saved', new Set());
        const far = farSceneFor(model, positions, new Set(), new Set(), scene, []);
        expect(far.nodes.map((node) => [node.id, node.group])).toEqual([
            ['1', groupKey],
            ['2', null],
            ['3', null],
            ['4', null],
        ]);
    });
});

describe('readFarPalette', () => {
    // A workflow often starts with a Note: its colours must not paint every other far box.
    it('takes the node looks from real nodes, never from a note', () => {
        const layer = document.createElement('div');
        layer.innerHTML = [
            '<div class="wg-node note" style="background-color: rgb(1, 1, 1)"></div>',
            '<div class="wg-node note bypass" style="background-color: rgb(2, 2, 2)"></div>',
            '<div class="wg-node note mute" style="background-color: rgb(3, 3, 3)"></div>',
            '<div class="wg-node" style="background-color: rgb(10, 10, 10)"></div>',
            '<div class="wg-node bypass" style="background-color: rgb(20, 20, 20)"></div>',
            '<div class="wg-node mute" style="background-color: rgb(30, 30, 30)"></div>',
        ].join('');
        document.body.appendChild(layer);
        try {
            const palette = readFarPalette(layer);
            expect(palette.node.plain.fill).toBe('rgb(10, 10, 10)');
            expect(palette.node.bypass.fill).toBe('rgb(20, 20, 20)');
            expect(palette.node.mute.fill).toBe('rgb(30, 30, 30)');
        } finally {
            layer.remove();
        }
    });
});

/** A canvas that records what is painted: each paint tagged with the colour it used, and the alpha at the time. */
const recordingCanvas = () => {
    const calls: string[] = [];
    const texts: string[] = [];
    const paints: string[] = [];
    const style = { fill: '', stroke: '', alpha: 1 };
    const ctx = new Proxy(
        { canvas: { width: 800, height: 600 }, measureText: (text: string) => ({ width: text.length }) },
        {
            get: (target, key) =>
                key in target
                    ? target[key as keyof typeof target]
                    : (...args: unknown[]) => {
                          calls.push(String(key));
                          if (key === 'fillText') texts.push(String(args[0]));
                          if (key === 'fill' || key === 'fillText') paints.push(`${String(key)}:${style.fill}@${style.alpha}`);
                          if (key === 'stroke') paints.push(`stroke:${style.stroke}@${style.alpha}`);
                      },
            set: (_target, key, value) => {
                if (key === 'fillStyle') style.fill = String(value);
                if (key === 'strokeStyle') style.stroke = String(value);
                if (key === 'globalAlpha') style.alpha = Number(value);
                return true;
            },
        }
    ) as unknown as CanvasRenderingContext2D;
    return { ctx, calls, texts, paints };
};

const look = { fill: 'a', stroke: 'b', alpha: 1, dashed: false };
const palette: FarPalette = {
    font: 'f',
    text: 't',
    muted: 'm',
    node: { plain: look, bypass: look, mute: look, reroute: look },
    wire: { latent: 'w' },
    group: new Map([[groupKey, { fill: 'g', stroke: 'g', titleColour: 'g', pillFill: 'g', pillStroke: 'g' }]]),
};

describe('drawFarScene', () => {
    const boxes: number[] = [];
    beforeEach(() => {
        boxes.length = 0;
        vi.stubGlobal(
            'Path2D',
            class {
                constructor(readonly d = '') {}
                roundRect() {
                    boxes.push(1);
                }
            }
        );
    });
    afterEach(() => vi.unstubAllGlobals());

    // The owner's ladder: far shows group titles and node titles, nothing more, so no node type line.
    it('paints each group, wire and node, the group title in its pill, and the title of each node that is not a reroute', () => {
        const { ctx, calls, texts, paints } = recordingCanvas();
        const { far } = farScene(new Set(), new Set());
        // Paths are built once; a frame replays them, one batch per look. Node 1 also has its group's tint.
        const drawing = prepareFarDrawing(far, palette);
        expect(boxes).toHaveLength(far.groups.length + far.nodes.length + 1);
        drawFarScene(ctx, drawing, { x: 0, y: 0, s: 0.4 }, 2);
        // The group, the four node looks and the title pill's backing.
        expect(calls.filter((call) => call === 'fill')).toHaveLength(far.groups.length + 4 + 1);
        expect(texts).toEqual(['Load', 'KSampler', 'Old', 'Loaders', '1 node']);

        // Far mode stacks like the HTML view: wires under groups, the group's box under every node, and its title
        // pill over the nodes, so a node in the band never hides the title.
        const lastWire = paints.lastIndexOf('stroke:w@1');
        const groupPaints = paints.flatMap((paint, index) => (paint.includes(':g@') ? [index] : []));
        const firstNode = paints.indexOf('fill:a@1');
        // Node titles (the first three texts) are muted, a step below the group title.
        const textPaints = paints.flatMap((paint, index) => (paint.startsWith('fillText') ? [index] : []));
        expect(textPaints.slice(0, 3).map((index) => paints[index])).toEqual(['fillText:m@1', 'fillText:m@1', 'fillText:m@1']);
        const lastNodeText = textPaints[2];
        expect(lastWire).toBeGreaterThanOrEqual(0);
        expect(groupPaints.length).toBe(5);
        const [boxFill, boxStroke, ...pill] = groupPaints;
        expect(boxFill).toBeGreaterThan(lastWire);
        expect(boxStroke).toBeLessThan(firstNode);
        expect(Math.min(...pill)).toBeGreaterThan(lastNodeText);
    });

    // The overview: soft shapes without borders, faint wires and group titles as the only text. The owner read a lone
    // output's title there ("SaveI…") as a bug.
    it('draws the overview with no node text, faint wires and borderless nodes', () => {
        const { ctx, texts, paints } = recordingCanvas();
        const { far } = farScene(new Set(), new Set());
        drawFarScene(ctx, prepareFarDrawing(far, palette), { x: 0, y: 0, s: 0.15 }, 1, 'overview');
        expect(texts).toEqual(['Loaders']);
        expect(paints).toContain('stroke:w@0.4');
        expect(paints).not.toContain('stroke:w@1');
        expect(paints.filter((paint) => paint.startsWith('stroke:b'))).toEqual([]);
        // Node 1 is tinted toward its group's colour.
        expect(paints.filter((paint) => paint === 'fill:g@0.35')).toHaveLength(1);
    });

    // Fitting every node's title is the costly step of a far frame. A zoom sweep must reuse a few fitted sizes rather
    // than fit all nodes again on nearly every wheel step, and the overview, which shows no node text, fits none (the
    // review found hundreds of full sets cached after one sweep of a 500-node graph).
    it('fits node titles at a few sizes over a far sweep, and none in the overview', () => {
        const { ctx } = recordingCanvas();
        const { far } = farScene(new Set(), new Set());
        const drawing = prepareFarDrawing(far, palette);
        for (let s = FAR_SCALE; s > OVERVIEW_SCALE; s *= 0.98) drawFarScene(ctx, drawing, { x: 0, y: 0, s }, 1, 'far');
        const farSizes = drawing.labels.size;
        expect(farSizes).toBeGreaterThan(0);
        expect(farSizes).toBeLessThanOrEqual(8);
        for (let s = OVERVIEW_SCALE; s > LOWEST_SCALE; s *= 0.98) drawFarScene(ctx, drawing, { x: 0, y: 0, s }, 1, 'overview');
        expect(drawing.labels.size).toBe(farSizes);
    });
});

describe('layoutGroupLabels', () => {
    const group = (key: string, title: string, x: number, y: number, w: number, h: number) => ({
        key,
        title,
        count: 2,
        shut: false,
        x,
        y,
        w,
        h,
    });
    const measure = (text: string, px: number) => text.length * px * 0.6;

    // On Lily every group keeps ComfyUI's default "Group". The owner wants group labels at Fit, so the overview keeps
    // them, and the node count beside a whole title is what tells such groups apart.
    it('keeps default "Group" titles in the overview, with the node count where it fits', () => {
        const drawing = { groups: [group('a', 'Group', 0, 0, 2000, 1000), group('b', 'Upscale', 0, 2000, 2000, 1000)] };
        expect(layoutGroupLabels(drawing, 0.1, 'overview', measure).map((label) => [label.text, label.count])).toEqual([
            ['Group', '2 nodes'],
            ['Upscale', '2 nodes'],
        ]);
        // A group with room for its title only drops the count, not the title.
        const s = 0.1;
        const titleOnly = (measure('Group', GROUP_TITLE_CAP_PX) + 2 * GROUP_TITLE_CAP_PX * 0.6 + 12 + 4) / s;
        const [narrow] = layoutGroupLabels({ groups: [group('a', 'Group', 0, 0, titleOnly, 1000)] }, s, 'overview', measure);
        expect(narrow).toMatchObject({ text: 'Group', count: null });
    });

    // Every pill sits at its group's top-left at every level, so it never moves while the view zooms.
    it('puts every pill at its group’s top-left, at every zoom', () => {
        const box = group('a', 'Upscale', 300, 100, 2000, 1000);
        for (const [s, level] of [
            [0.45, 'far'],
            [0.3, 'far'],
            [0.15, 'overview'],
        ] as const) {
            const [label] = layoutGroupLabels({ groups: [box] }, s, level, measure);
            // Inset from the corner by at most 6 px on screen, the same along both edges.
            const inset = label.rect.x - box.x;
            expect(inset).toBeGreaterThan(0);
            expect(inset * s).toBeLessThanOrEqual(6 + 1e-9);
            expect(label.rect.y - box.y).toBeCloseTo(inset, 9);
        }
    });

    // Titles that would overlap: the bigger group's wins.
    it('keeps the bigger group’s title where two overlap in the overview', () => {
        const big = group('big', 'Sampling', 0, 0, 3000, 2000);
        const small = group('small', 'Loaders', 40, 0, 1000, 500);
        const labels = layoutGroupLabels({ groups: [small, big] }, 0.1, 'overview', measure);
        expect(labels.map((label) => label.key)).toEqual(['big']);
    });

    it('shows each far title with its node count, in a pill inside the group’s top band', () => {
        const [label] = layoutGroupLabels({ groups: [group('a', 'Upscale', 0, 100, 2000, 1000)] }, 0.3, 'far', measure);
        expect(label).toMatchObject({ kind: 'pill', text: 'Upscale', count: '2 nodes' });
        expect(label.rect.y).toBeGreaterThan(100);
    });

    // In a narrow group the title gets the room first: the count goes before the title is cut. On 152349 the
    // pill read "Step1 - L… 2 nodes", which kept the count and lost the group's name.
    it('drops the node count before cutting the title in a narrow group', () => {
        const s = 0.3;
        // The far pill is the near pill scaled by k, so the room is reckoned in near-pill units.
        const k = farGroupTitlePx(s) / (NEAR_GROUP_TITLE_PX * s);
        const title = 'Step1 - Load models';
        // Room for the whole title, but not for the title and its count.
        const w = k * (2 * TITLE_INSET + TITLE_CHROME + measure(title, NEAR_GROUP_TITLE_PX) + measure('2 nodes', 11) / 2);
        const [narrow] = layoutGroupLabels({ groups: [group('a', title, 0, 100, w, 1000)] }, s, 'far', measure);
        expect(narrow).toMatchObject({ text: title, count: null });
        // Narrower still, the title is cut, and the count still stays out.
        const [cut] = layoutGroupLabels({ groups: [group('a', title, 0, 100, w * 0.6, 1000)] }, s, 'far', measure);
        expect(cut.text.endsWith('…')).toBe(true);
        expect(cut.count).toBeNull();
    });
});

describe('farGroupTitlePx', () => {
    // At the switch a far title is exactly as big on screen as the near pill's, so nothing jumps; it then grows to the cap.
    it('starts at the near title size and grows to the cap', () => {
        expect(farGroupTitlePx(FAR_SCALE)).toBeCloseTo(NEAR_GROUP_TITLE_PX * FAR_SCALE);
        expect(farGroupTitlePx(0.3)).toBeGreaterThan(farGroupTitlePx(0.4));
        expect(farGroupTitlePx(0.05)).toBe(GROUP_TITLE_CAP_PX);
    });
});

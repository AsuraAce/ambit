import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    drawFarScene,
    farGroupTitlePx,
    farSceneFor,
    layoutGroupLabels,
    NEAR_GROUP_TITLE_PX,
    prepareFarDrawing,
    readFarPalette,
    TYPE_LINE_SCALE,
    type FarPalette,
} from '../farCanvas';
import { FAR_SCALE, groupBox, nodeHeight, sceneFor, wirePaths } from '../geometry';
import { GROUP_TITLE_CAP_PX } from '../groupTitles';
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
        // The type is a second line only when the title does not already say it.
        expect(far.nodes[0].nodeType).toBe('CheckpointLoader');
        expect(far.nodes[1].nodeType).toBeNull();
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

    // The overview tints each node toward its group, and keeps the titles of the selected outputs only.
    it('marks each node with its innermost open group and the selected outputs as anchors', () => {
        const scene = sceneFor(model, 'saved', new Set());
        const far = farSceneFor(model, positions, new Set(), new Set(), scene, [], new Map(), new Set(['2']));
        expect(far.nodes.map((node) => [node.id, node.group, node.anchor])).toEqual([
            ['1', groupKey, false],
            ['2', null, true],
            ['3', null, false],
            ['4', null, false],
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

    it('paints each group, wire and node, the group title in its pill, and the title of each node that is not a reroute', () => {
        const { ctx, calls, texts, paints } = recordingCanvas();
        const { far } = farScene(new Set(), new Set());
        // Paths are built once; a frame replays them, one batch per look. Node 1 also has its group's tint.
        const drawing = prepareFarDrawing(far, palette);
        expect(boxes).toHaveLength(far.groups.length + far.nodes.length + 1);
        drawFarScene(ctx, drawing, { x: 0, y: 0, s: 0.4 }, 2);
        // The group, the four node looks and the title pill's backing.
        expect(calls.filter((call) => call === 'fill')).toHaveLength(far.groups.length + 4 + 1);
        expect(texts).toEqual(['Load', 'KSampler', 'Old', 'CheckpointLoader', 'KSampler', 'Loaders', '1 node']);

        // Far mode stacks like the HTML view: wires under groups, the group's box under every node, and its title
        // pill over the nodes, so a node in the band never hides the title.
        const lastWire = paints.lastIndexOf('stroke:w@1');
        const groupPaints = paints.flatMap((paint, index) => (paint.includes(':g@') ? [index] : []));
        const firstNode = paints.indexOf('fill:a@1');
        const lastNodeText = paints.lastIndexOf('fillText:t@1');
        expect(lastWire).toBeGreaterThanOrEqual(0);
        expect(groupPaints.length).toBe(5);
        const [boxFill, boxStroke, ...pill] = groupPaints;
        expect(boxFill).toBeGreaterThan(lastWire);
        expect(boxStroke).toBeLessThan(firstNode);
        expect(Math.min(...pill)).toBeGreaterThan(lastNodeText);
    });

    // Below 35 % the node type line is noise: titles only.
    it('drops the node type line below TYPE_LINE_SCALE', () => {
        const { ctx, texts } = recordingCanvas();
        const { far } = farScene(new Set(), new Set());
        drawFarScene(ctx, prepareFarDrawing(far, palette), { x: 0, y: 0, s: TYPE_LINE_SCALE - 0.01 }, 1);
        expect(texts).not.toContain('CheckpointLoader');
        expect(texts).toContain('Load');
    });

    // The overview: soft shapes without borders, faint wires, group titles, and the selected outputs' titles only.
    it('draws the overview with no node text but the selected outputs, faint wires and borderless nodes', () => {
        const { ctx, texts, paints } = recordingCanvas();
        const scene = sceneFor(model, 'saved', new Set());
        const wires = wirePaths(model, positions, new Set(), scene, 'bundled');
        const far = farSceneFor(model, positions, new Set(), new Set(), scene, wires, new Map(), new Set(['2']));
        drawFarScene(ctx, prepareFarDrawing(far, palette), { x: 0, y: 0, s: 0.15 }, 1, 'overview');
        expect(texts).toEqual(['KSampler', 'Loaders']);
        expect(paints).toContain('stroke:w@0.4');
        expect(paints).not.toContain('stroke:w@1');
        expect(paints.filter((paint) => paint.startsWith('stroke:b'))).toEqual([]);
        // Node 1 is tinted toward its group's colour.
        expect(paints.filter((paint) => paint === 'fill:g@0.35')).toHaveLength(1);
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

    // ComfyUI names a new group "Group": in the overview that says nothing, so it is left out; far mode keeps it.
    it('leaves default "Group" titles out of the overview only', () => {
        const drawing = { groups: [group('a', 'Group', 0, 0, 2000, 1000), group('b', 'Upscale', 0, 2000, 2000, 1000)], boxes: [] };
        expect(layoutGroupLabels(drawing, 0.1, 'overview', measure, []).map((label) => label.text)).toEqual(['Upscale']);
        expect(layoutGroupLabels(drawing, 0.3, 'far', measure, []).map((label) => label.text)).toEqual(['Group', 'Upscale']);
    });

    // Titles that would overlap: the bigger group's wins.
    it('keeps the bigger group’s title where two overlap in the overview', () => {
        const big = group('big', 'Sampling', 0, 0, 3000, 2000);
        const small = group('small', 'Loaders', 40, 0, 1000, 500);
        const labels = layoutGroupLabels({ groups: [small, big], boxes: [] }, 0.1, 'overview', measure, []);
        expect(labels.map((label) => label.key)).toEqual(['big']);
    });

    it('shows each far title with its node count, in a pill inside the group’s top band', () => {
        const [label] = layoutGroupLabels({ groups: [group('a', 'Upscale', 0, 100, 2000, 1000)], boxes: [] }, 0.3, 'far', measure, []);
        expect(label).toMatchObject({ kind: 'pill', text: 'Upscale', count: '2 nodes' });
        expect(label.rect.y).toBeGreaterThan(100);
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

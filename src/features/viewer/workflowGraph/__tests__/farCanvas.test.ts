import { afterEach, describe, expect, it, vi } from 'vitest';
import { drawFarScene, farSceneFor, prepareFarDrawing, readFarPalette, type FarPalette } from '../farCanvas';
import { groupBox, nodeHeight, sceneFor, wirePaths } from '../geometry';
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
        expect(far.groups).toEqual([{ key: groupKey, title: 'Loaders', shut: true, ...groupBox(model.groups[0], true) }]);
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

describe('drawFarScene', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('paints each group, wire and node, and the title of each node that is not a reroute', () => {
        const boxes: number[] = [];
        vi.stubGlobal(
            'Path2D',
            class {
                constructor(readonly d = '') {}
                roundRect() {
                    boxes.push(1);
                }
            }
        );
        const calls: string[] = [];
        const texts: string[] = [];
        // Each paint, tagged with the colour it used: groups paint in 'g', nodes in 'a'/'b', wires in 'w'.
        const paints: string[] = [];
        const style = { fill: '', stroke: '' };
        const ctx = new Proxy(
            { canvas: { width: 800, height: 600 }, measureText: (text: string) => ({ width: text.length }) },
            {
                get: (target, key) =>
                    key in target
                        ? target[key as keyof typeof target]
                        : (...args: unknown[]) => {
                              calls.push(String(key));
                              if (key === 'fillText') texts.push(String(args[0]));
                              if (key === 'fill' || key === 'fillText') paints.push(`${String(key)}:${style.fill}`);
                              if (key === 'stroke') paints.push(`stroke:${style.stroke}`);
                          },
                set: (_target, key, value) => {
                    if (key === 'fillStyle') style.fill = String(value);
                    if (key === 'strokeStyle') style.stroke = String(value);
                    return true;
                },
            }
        ) as unknown as CanvasRenderingContext2D;
        const look = { fill: 'a', stroke: 'b', alpha: 1, dashed: false };
        const palette: FarPalette = {
            font: 'f',
            text: 't',
            muted: 'm',
            node: { plain: look, bypass: look, mute: look, reroute: look },
            wire: { latent: 'w' },
            group: new Map([[groupKey, { fill: 'g', stroke: 'g', title: 'g' }]]),
        };
        const { far } = farScene(new Set(), new Set());
        // Paths and labels are built once; a frame replays them, one batch per look.
        const drawing = prepareFarDrawing(ctx, far, palette);
        expect(boxes).toHaveLength(far.groups.length + far.nodes.length);
        drawFarScene(ctx, drawing, { x: 0, y: 0, s: 0.2 }, 2);
        expect(calls.filter((call) => call === 'fill')).toHaveLength(far.groups.length + 4);
        expect(texts).toEqual(['Loaders', 'Load', 'KSampler', 'Old', 'CheckpointLoader', 'KSampler']);

        // Far mode stacks like the HTML view: wires under groups, and a group's box and title under every node,
        // so a group that overlaps nodes in the saved layout never paints its title across them.
        const lastWire = paints.lastIndexOf('stroke:w');
        const groupPaints = paints.flatMap((paint, index) => (paint.endsWith(':g') ? [index] : []));
        const firstNode = paints.indexOf('fill:a');
        expect(lastWire).toBeGreaterThanOrEqual(0);
        expect(groupPaints.length).toBe(3);
        expect(Math.min(...groupPaints)).toBeGreaterThan(lastWire);
        expect(Math.max(...groupPaints)).toBeLessThan(firstNode);
    });
});

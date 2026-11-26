import { describe, expect, it } from 'vitest';
import { buildGraphModel, COORD_LIMIT, HEADER_H, savedPositions, WIDGET_TEXT_LIMIT, wireTypeOf } from '../graphModel';
import { canvasGroup, canvasLink, canvasNode, level, port } from './canvasFixtures';

describe('saved-position mapping', () => {
    // ComfyUI saves a node's body position; its title bar is drawn above it. Drawing at pos would push
    // every node 30 px down and misplace it against its group.
    it('puts the title bar above the saved position, as ComfyUI draws it', () => {
        const model = buildGraphModel(level([canvasNode('1', { pos: { x: 100, y: 200 } })]));
        expect(savedPositions(model).get('1')).toEqual({ x: 100, y: 200 - HEADER_H });
    });

    it('draws a reroute at its saved position, since it has no title bar', () => {
        const model = buildGraphModel(level([canvasNode('r', { kind: 'reroute', nodeType: 'Reroute', pos: { x: 40, y: 50 } })]));
        expect(savedPositions(model).get('r')).toEqual({ x: 40, y: 50 });
    });

    it('clamps negative, huge and non-finite positions from the file', () => {
        const model = buildGraphModel(
            level([
                canvasNode('far', { pos: { x: 1e12, y: -1e12 } }),
                canvasNode('nan', { pos: { x: Number.NaN, y: Number.POSITIVE_INFINITY } }),
                canvasNode('neg', { pos: { x: -500, y: -400 } }),
            ])
        );
        const positions = savedPositions(model);
        expect(positions.get('far')).toEqual({ x: COORD_LIMIT, y: -COORD_LIMIT });
        expect(positions.get('nan')).toEqual({ x: 0, y: 0 });
        expect(positions.get('neg')).toEqual({ x: -500, y: -400 - HEADER_H });
    });

    it('places nodes the file left without a position in a row below the rest, never on top of them', () => {
        const model = buildGraphModel(
            level([
                canvasNode('placed', { pos: { x: 10, y: 30 } }),
                canvasNode('loose', { pos: null }),
                canvasNode('loose2', { pos: null }),
            ])
        );
        const positions = savedPositions(model);
        const placed = model.byId.get('placed')!;
        const bottom = positions.get('placed')!.y + placed.height;
        expect(positions.get('loose')!.y).toBeGreaterThan(bottom);
        expect(positions.get('loose2')!.x).toBeGreaterThan(positions.get('loose')!.x);
    });

    it('keeps the saved size as the minimum, with the title bar on top', () => {
        const model = buildGraphModel(level([canvasNode('1', { size: { width: 333, height: 120 } })]));
        const node = model.byId.get('1')!;
        expect(node.width).toBe(333);
        expect(node.minHeight).toBe(120 + HEADER_H);
        expect(node.height).toBeGreaterThanOrEqual(120 + HEADER_H);
    });
});

describe('graph model from the canvas report', () => {
    it('drops a link to a node the level lacks but draws a link to a slot its node does not list', () => {
        const model = buildGraphModel(
            level(
                [canvasNode('a', { outputs: [port(0, 'LATENT')] }), canvasNode('b', { inputs: [port(0, 'LATENT')] })],
                [canvasLink('a', 0, 'b', 0), canvasLink('a', 0, 'missing', 0), canvasLink('a', 7, 'b', 9)]
            )
        );
        expect(model.links.map((link) => [link.from, link.fromSlot, link.to, link.toSlot])).toEqual([
            ['a', 0, 'b', 0],
            ['a', 7, 'b', 9],
        ]);
    });

    it('places port pins by row, so wires meet the drawn dots', () => {
        const model = buildGraphModel(level([canvasNode('k', { inputs: [port(0, 'MODEL'), port(3, 'LATENT')] })]));
        const node = model.byId.get('k')!;
        expect(node.inPin.get(3)! - node.inPin.get(0)!).toBe(20);
        expect(node.inPin.has(1)).toBe(false);
    });

    it('maps file type names to fixed token keys, and anything unknown to "any"', () => {
        expect(wireTypeOf('LATENT')).toBe('latent');
        expect(wireTypeOf('conditioning')).toBe('cond');
        expect(wireTypeOf('UNET')).toBe('model');
        expect(wireTypeOf('url(evil)')).toBe('any');
        expect(wireTypeOf('*')).toBe('any');
    });

    // A made-up name such as "Value 2" reads as if the file said it; an unnamed value stays unnamed.
    it('leaves a setting the file does not name unnamed, and cuts very long values for display', () => {
        const long = 'x'.repeat(WIDGET_TEXT_LIMIT + 50);
        const model = buildGraphModel(
            level([
                canvasNode('1', {
                    widgets: [
                        { name: 'seed', value: '42', isLongText: false },
                        { name: null, value: long, isLongText: true },
                    ],
                }),
            ])
        );
        const [seed, text] = model.byId.get('1')!.widgets;
        expect(seed.name).toBe('seed');
        expect(text.name).toBeNull();
        expect(text.value.length).toBe(WIDGET_TEXT_LIMIT + 1);
    });

    // The count in a group's header must match what ComfyUI shows for the same file: ComfyUI counts a node
    // whose centre is inside the group, even when the node's box hangs over the group's edge.
    it("counts a node in a group by ComfyUI's rule: the centre of its box lies inside", () => {
        const model = buildGraphModel(
            level(
                [
                    canvasNode('in', { pos: { x: 20, y: 60 }, size: { width: 100, height: 50 } }),
                    // Hangs 50 px past the right edge, centre inside.
                    canvasNode('overhang', { pos: { x: 250, y: 60 }, size: { width: 200, height: 50 } }),
                    // Taller than the room left below it, centre still inside.
                    canvasNode('tall', { pos: { x: 20, y: 200 }, size: { width: 100, height: 160 } }),
                    // Centre past the right edge.
                    canvasNode('out', { pos: { x: 350, y: 60 }, size: { width: 200, height: 50 } }),
                ],
                [],
                [canvasGroup('Group', 0, 0, 400, 300)]
            )
        );
        expect(model.groups[0].members).toEqual(['in', 'overhang', 'tall']);
    });
});

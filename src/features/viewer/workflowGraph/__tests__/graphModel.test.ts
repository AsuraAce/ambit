import { describe, expect, it } from 'vitest';
import { buildGraphModel, COORD_LIMIT, DOOR_H, HEADER_H, savedPositions, WIDGET_TEXT_LIMIT, wireTypeOf } from '../graphModel';
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

describe('subgraph instance titles', () => {
    const uuid = '3f1c2a9e-0b7d-4c55-9a61-2d0e8b5f7c10';
    const instance = (title: string) => canvasNode('9', { kind: 'subgraph', nodeType: uuid, subgraphId: uuid, title });

    // A subgraph's type is a UUID: its node is named as its breadcrumb is, by the definition's name.
    it('names an instance by its definition, as the breadcrumb does', () => {
        const names = new Map([[uuid, { name: 'Upscale and sharpen', nodes: 3 }]]);
        expect(buildGraphModel(level([instance('')]), names).byId.get('9')!.title).toBe('Upscale and sharpen');
        expect(buildGraphModel(level([instance('My title')]), names).byId.get('9')!.title).toBe('Upscale and sharpen');
    });

    it('falls back to the instance title, then the type, when the definition has no name', () => {
        const unnamed = new Map([[uuid, { name: '', nodes: 3 }]]);
        expect(buildGraphModel(level([instance('My title')]), unnamed).byId.get('9')!.title).toBe('My title');
        expect(buildGraphModel(level([instance('My title')])).byId.get('9')!.title).toBe('My title');
        expect(buildGraphModel(level([instance('')])).byId.get('9')!.title).toBe(uuid);
    });
});

// The owner's pick for the Open button: a row under the body, "Open subgraph · N nodes inside".
describe('a subgraph instance’s open row', () => {
    const uuid = 'def';
    const instance = canvasNode('9', { kind: 'subgraph', nodeType: uuid, subgraphId: uuid, size: { width: 260, height: 120 } });

    it('counts the nodes inside, and makes room for the row under the saved body', () => {
        const without = buildGraphModel(level([instance])).byId.get('9')!;
        const known = buildGraphModel(level([instance]), new Map([[uuid, { name: 'Stage', nodes: 7 }]])).byId.get('9')!;
        expect(known.inside).toBe(7);
        expect(known.height).toBe(without.height + DOOR_H);
        // Group membership follows the file's own box, which has no row.
        expect(known.minHeight).toBe(without.minHeight);
    });

    // A group's count must match ComfyUI's for the same file, which knows nothing of the row.
    it('keeps the row out of group membership for a node saved without a size', () => {
        const sizeless = canvasNode('9', { kind: 'subgraph', nodeType: uuid, subgraphId: uuid, size: null, pos: { x: 20, y: 60 } });
        const plain = buildGraphModel(level([sizeless])).byId.get('9')!;
        // The group's bottom edge sits just under the centre of the file's box, above the centre the row would give it.
        const bottom = plain.saved!.y + plain.height / 2 + DOOR_H / 4;
        const grouped = buildGraphModel(
            level([sizeless], [], [canvasGroup('Group', 0, 0, 400, bottom)]),
            new Map([[uuid, { name: 'Stage', nodes: 7 }]])
        );
        expect(grouped.byId.get('9')!.height).toBe(plain.height + DOOR_H);
        expect(grouped.groups[0].members).toEqual(['9']);
    });

    // The row is added below the slots, so wires still meet the drawn pins.
    it('leaves the port pins where they are', () => {
        const ported = canvasNode('9', {
            kind: 'subgraph',
            nodeType: uuid,
            subgraphId: uuid,
            inputs: [port(0, 'LATENT')],
            outputs: [port(1, 'IMAGE')],
        });
        const without = buildGraphModel(level([ported])).byId.get('9')!;
        const known = buildGraphModel(level([ported]), new Map([[uuid, { name: 'Stage', nodes: 7 }]])).byId.get('9')!;
        expect(known.inside).toBe(7);
        expect(known.inPin).toEqual(without.inPin);
        expect(known.outPin).toEqual(without.outPin);
    });

    // Without a definition the report cannot open it, so there is no row to make room for.
    it('has no count and no row when the report has no definition for it', () => {
        const node = buildGraphModel(level([instance]), new Map([['other', { name: 'Other', nodes: 2 }]])).byId.get('9')!;
        expect(node.inside).toBeNull();
        expect(buildGraphModel(level([canvasNode('p')]), new Map([[uuid, { name: 'Stage', nodes: 7 }]])).byId.get('p')!.inside).toBeNull();
    });
});

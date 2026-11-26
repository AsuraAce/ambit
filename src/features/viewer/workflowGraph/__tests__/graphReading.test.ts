import { describe, expect, it } from 'vitest';
import type { Rect } from '../geometry';
import { buildGraphModel } from '../graphModel';
import { linksOf, nextNode, SEARCH_RESULT_LIMIT, searchGraph } from '../graphReading';
import { canvasLink, canvasNode, level, port } from './canvasFixtures';

const widget = (name: string | null, value: string) => ({ name, value, isLongText: false });

const pipeline = buildGraphModel(
    level(
        [
            canvasNode('ckpt', {
                title: 'Load Checkpoint',
                nodeType: 'CheckpointLoaderSimple',
                outputs: [port(0, 'MODEL'), port(1, 'CLIP')],
            }),
            canvasNode('pos', {
                title: 'Positive',
                nodeType: 'CLIPTextEncode',
                inputs: [port(0, 'CLIP')],
                outputs: [port(0, 'CONDITIONING')],
                widgets: [widget('text', 'a red fox in the snow')],
            }),
            canvasNode('ks', {
                title: 'KSampler',
                nodeType: 'KSampler',
                inputs: [port(0, 'MODEL'), port(1, 'CONDITIONING')],
                widgets: [widget('seed', '42'), widget(null, 'euler')],
            }),
            canvasNode('r', { kind: 'reroute', title: 'Reroute fox', nodeType: 'Reroute' }),
        ],
        [canvasLink('ckpt', 0, 'ks', 0, 'MODEL'), canvasLink('ckpt', 1, 'pos', 0, 'CLIP'), canvasLink('pos', 0, 'ks', 1, 'CONDITIONING')]
    )
);

describe('linksOf', () => {
    // The side panel lists where each input comes from and where each output goes, in port order.
    it('lists the wires in and out of a node by port, naming the other node and its port', () => {
        const sampler = linksOf(pipeline, 'ks');
        expect(sampler.from.map((row) => [row.port, row.other.id, row.otherPort])).toEqual([
            ['model', 'ckpt', 'model'],
            ['conditioning', 'pos', 'conditioning'],
        ]);
        expect(sampler.to).toEqual([]);
        const loader = linksOf(pipeline, 'ckpt');
        expect(loader.to.map((row) => [row.port, row.other.id, row.type])).toEqual([
            ['model', 'ks', 'model'],
            ['clip', 'pos', 'clip'],
        ]);
        expect(linksOf(pipeline, 'missing')).toEqual({ from: [], to: [] });
    });
});

describe('searchGraph', () => {
    it('is no search for an empty or blank query', () => {
        expect(searchGraph(pipeline, '')).toBeNull();
        expect(searchGraph(pipeline, '   ')).toBeNull();
    });

    // A user looking for "the fox prompt" types words from it in any order and case.
    it('matches every word, case ignored, across title, type, setting names and values', () => {
        expect([...searchGraph(pipeline, 'FOX snow')!.ids]).toEqual(['pos']);
        expect([...searchGraph(pipeline, 'clip')!.ids].sort()).toEqual(['pos']);
        expect([...searchGraph(pipeline, 'seed 42')!.ids]).toEqual(['ks']);
        expect([...searchGraph(pipeline, 'euler')!.ids]).toEqual(['ks']);
        expect(searchGraph(pipeline, 'fox tiger')!.ids.size).toBe(0);
    });

    it('never matches a reroute, which has no text of its own', () => {
        expect(searchGraph(pipeline, 'reroute')!.ids.size).toBe(0);
    });

    it('lists title matches first, and says what else matched', () => {
        const model = buildGraphModel(
            level([
                canvasNode('a', { title: 'Upscale', nodeType: 'X', widgets: [widget('mode', 'sampler bicubic')] }),
                canvasNode('b', { title: 'Sampler', nodeType: 'KSampler' }),
            ])
        );
        const hits = searchGraph(model, 'sampler')!;
        expect(hits.results.map((result) => [result.id, result.detail])).toEqual([
            ['b', 'KSampler'],
            ['a', 'mode: sampler bicubic'],
        ]);
    });

    it(`lists at most ${SEARCH_RESULT_LIMIT} results but counts and marks every match`, () => {
        const many = buildGraphModel(
            level(Array.from({ length: SEARCH_RESULT_LIMIT + 5 }, (_, index) => canvasNode(String(index), { title: `Load ${index}` })))
        );
        const hits = searchGraph(many, 'load')!;
        expect(hits.results).toHaveLength(SEARCH_RESULT_LIMIT);
        expect(hits.total).toBe(SEARCH_RESULT_LIMIT + 5);
        expect(hits.ids.size).toBe(SEARCH_RESULT_LIMIT + 5);
    });
});

describe('nextNode', () => {
    const rect = (x: number, y: number, w = 100, h = 60): Rect => ({ x, y, w, h });
    const rects = new Map<string, Rect>([
        ['ckpt', rect(0, 0)],
        ['pos', rect(200, -200)],
        ['ks', rect(400, 0)],
        ['r', rect(0, 300)],
    ]);

    // Right and Left follow the wires, as a user reads a workflow from its loaders to its output.
    it('follows the first output wire right and the first input wire left', () => {
        expect(nextNode(pipeline, rects, 'ckpt', 'right')).toBe('ks');
        expect(nextNode(pipeline, rects, 'ks', 'left')).toBe('ckpt');
        expect(nextNode(pipeline, rects, 'pos', 'left')).toBe('ckpt');
    });

    it('skips a wired node that is not drawn, as when a folded group hides it', () => {
        const hidden = new Map(rects);
        hidden.delete('ks');
        expect(nextNode(pipeline, hidden, 'ckpt', 'right')).toBe('pos');
    });

    it('goes up and down to the node straight above or below first', () => {
        expect(nextNode(pipeline, rects, 'ckpt', 'down')).toBe('r');
        expect(nextNode(pipeline, rects, 'r', 'up')).toBe('ckpt');
    });

    // The planner's rule: an arrow is never dead while some node lies that way.
    it('falls back to the nearest node that way when none overlaps', () => {
        expect(nextNode(pipeline, rects, 'ks', 'up')).toBe('pos');
        expect(nextNode(pipeline, rects, 'ks', 'down')).toBe('r');
        // A node with no wire out goes right to the nearest node that way.
        expect(nextNode(pipeline, rects, 'pos', 'right')).toBe('ks');
    });

    it('is null only when nothing lies that way, or the node is not drawn', () => {
        expect(nextNode(pipeline, rects, 'pos', 'up')).toBeNull();
        expect(nextNode(pipeline, rects, 'r', 'down')).toBeNull();
        expect(nextNode(pipeline, rects, 'gone', 'down')).toBeNull();
    });
});

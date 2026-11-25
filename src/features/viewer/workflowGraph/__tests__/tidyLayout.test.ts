import { describe, expect, it } from 'vitest';
import { buildGraphModel } from '../graphModel';
import { handleLayoutRequest, type LayoutInput } from '../tidyLayout';
import { layoutInputFor } from '../useTidyPositions';
import { canvasLink, canvasNode, level, port } from './canvasFixtures';

const chain: LayoutInput = {
    nodes: [
        { id: 'loader', width: 300, height: 100 },
        { id: 'sampler', width: 300, height: 260 },
        { id: 'decode', width: 200, height: 60 },
        { id: 'loose', width: 200, height: 60 },
    ],
    edges: [
        { from: 'loader', to: 'sampler' },
        { from: 'sampler', to: 'decode' },
        { from: 'decode', to: 'decode' },
        { from: 'decode', to: 'gone' },
    ],
};

describe('layout worker contract', () => {
    it('answers with the request id and a position for every node', () => {
        const response = handleLayoutRequest({ requestId: 7, input: chain });
        expect(response.requestId).toBe(7);
        if ('error' in response) throw new Error('layout failed');
        expect(Object.keys(response.positions).sort()).toEqual(['decode', 'loader', 'loose', 'sampler']);
    });

    it('lays the graph out left to right, so each wire runs forward', () => {
        const response = handleLayoutRequest({ requestId: 1, input: chain });
        if ('error' in response) throw new Error('layout failed');
        const { loader, sampler, decode } = response.positions;
        expect(loader.x + 300).toBeLessThan(sampler.x);
        expect(sampler.x + 300).toBeLessThan(decode.x);
    });

    it('reports a failure without echoing anything from the request', () => {
        const response = handleLayoutRequest({ requestId: 3, input: { nodes: null, edges: [] } as unknown as LayoutInput });
        expect(response).toEqual({ requestId: 3, error: 'layout_failed' });
    });

    // The worker gets sizes and connections only: no titles, settings or prompts leave the view.
    it('sends the worker ids, sizes and connections only', () => {
        const model = buildGraphModel(
            level(
                [
                    canvasNode('a', {
                        title: 'secret title',
                        outputs: [port(0, 'LATENT')],
                        widgets: [{ name: 'text', value: 'secret prompt', isLongText: true }],
                    }),
                    canvasNode('b', { inputs: [port(0, 'LATENT')] }),
                ],
                [canvasLink('a', 0, 'b', 0)]
            )
        );
        const input = layoutInputFor(model);
        expect(JSON.stringify(input)).not.toContain('secret');
        expect(Object.keys(input.nodes[0]).sort()).toEqual(['height', 'id', 'width']);
        expect(input.edges).toEqual([{ from: 'a', to: 'b' }]);
    });
});

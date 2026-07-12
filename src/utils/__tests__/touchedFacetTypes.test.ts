import { describe, expect, it } from 'vitest';
import { GeneratorTool } from '../../types';
import {
    collectTouchedFacetResourcesFromMetadata,
    collectTouchedFacetResourcesFromMetadataDiff,
    collectTouchedFacetTypesFromMetadata,
    collectTouchedFacetTypesFromMetadataDiff,
    createEmptyTouchedFacetResources,
    hasTouchedFacetResources,
    mergeTouchedFacetResources,
    orderFacetTypes,
    touchedFacetResourcesToTypes,
} from '../touchedFacetTypes';

describe('touchedFacetTypes', () => {
    it('creates independent empty resource sets and orders known unique facet types', () => {
        const first = createEmptyTouchedFacetResources();
        const second = createEmptyTouchedFacetResources();
        first.loras.push('one');

        expect(second.loras).toEqual([]);
        expect(orderFacetTypes(['tools', 'unknown', 'loras', 'tools', 'checkpoints'])).toEqual([
            'checkpoints',
            'loras',
            'tools',
        ]);
    });

    it('always touches checkpoint and tool counts and detects every optional resource family', () => {
        expect(collectTouchedFacetTypesFromMetadata(null)).toEqual(['checkpoints', 'tools']);
        expect(collectTouchedFacetTypesFromMetadata({
            loras: ['lora'],
            embeddings: ['embedding'],
            hypernetworks: ['hypernetwork'],
            controlNets: ['control'],
            ipAdapters: ['adapter'],
        })).toEqual([
            'checkpoints',
            'loras',
            'embeddings',
            'hypernetworks',
            'controlNets',
            'ipAdapters',
            'tools',
        ]);
        expect(collectTouchedFacetTypesFromMetadata({
            loras: [], embeddings: [], hypernetworks: [], controlNets: [], ipAdapters: [],
        })).toEqual(['checkpoints', 'tools']);
    });

    it('normalizes resource names, weights, extensions, fallbacks, and duplicates', () => {
        expect(collectTouchedFacetResourcesFromMetadata(null)).toEqual(createEmptyTouchedFacetResources());

        const resources = collectTouchedFacetResourcesFromMetadata({
            tool: '' as GeneratorTool,
            model: 'ignored.ckpt',
            overrideModel: ' Flux Base.safetensors ',
            loras: ['Detail.safetensors (0.8)', 'Detail.safetensors (0.8)', 'Style:0.5', 'Both:0.5 (legacy)', ''],
            embeddings: ['Embed.pt'],
            hypernetworks: ['Hyper.bin'],
            controlNets: ['Control.pth'],
            ipAdapters: ['Adapter.ckpt'],
        });

        expect(resources).toEqual({
            checkpoints: ['Flux Base'],
            loras: ['Detail', 'Style', 'Both'],
            embeddings: ['Embed'],
            hypernetworks: ['Hyper'],
            controlNets: ['Control'],
            ipAdapters: ['Adapter'],
            tools: ['Unknown'],
        });
        expect(collectTouchedFacetResourcesFromMetadata({ model: '', tool: GeneratorTool.UNKNOWN }))
            .toMatchObject({ checkpoints: ['Unknown'], tools: [GeneratorTool.UNKNOWN] });
    });

    it('merges unique resource names and reports resource presence in facet order', () => {
        const first = {
            checkpoints: ['A'], loras: ['L'], embeddings: ['E'], hypernetworks: [],
            controlNets: ['C'], ipAdapters: [], tools: ['T'],
        };
        const second = {
            checkpoints: ['A', 'B'], loras: ['L2'], embeddings: [], hypernetworks: ['H'],
            controlNets: [], ipAdapters: ['I'], tools: ['T'],
        };
        const merged = mergeTouchedFacetResources(first, second);

        expect(merged).toEqual({
            checkpoints: ['A', 'B'], loras: ['L', 'L2'], embeddings: ['E'], hypernetworks: ['H'],
            controlNets: ['C'], ipAdapters: ['I'], tools: ['T'],
        });
        expect(hasTouchedFacetResources(createEmptyTouchedFacetResources())).toBe(false);
        expect(hasTouchedFacetResources(merged)).toBe(true);
        expect(touchedFacetResourcesToTypes(merged)).toEqual([
            'checkpoints', 'loras', 'embeddings', 'hypernetworks', 'controlNets', 'ipAdapters', 'tools',
        ]);
    });

    it('unions touched types and resource names across metadata diffs', () => {
        const previous = { model: 'Old.ckpt', loras: ['Old.safetensors'] };
        const next = { model: 'New.ckpt', embeddings: ['Token.pt'] };

        expect(collectTouchedFacetTypesFromMetadataDiff(previous, next)).toEqual([
            'checkpoints', 'loras', 'embeddings', 'tools',
        ]);
        expect(collectTouchedFacetResourcesFromMetadataDiff(previous, next)).toMatchObject({
            checkpoints: ['Old', 'New'],
            loras: ['Old'],
            embeddings: ['Token'],
            tools: ['Unknown'],
        });
    });
});

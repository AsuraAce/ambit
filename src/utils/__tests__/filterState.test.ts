import { describe, expect, it } from 'vitest';
import { FilterState, GeneratorTool } from '../../types';
import { createCollectionSelectionFilters } from '../filterState';

const activeFilters: FilterState = {
    searchQuery: 'portrait',
    models: ['model-a'],
    tools: [GeneratorTool.INVOKEAI],
    loras: ['lora-a'],
    embeddings: ['embedding-a'],
    hypernetworks: ['hypernetwork-a'],
    controlNets: ['controlnet-a'],
    ipAdapters: ['ipadapter-a'],
    samplers: ['sampler-a'],
    generationTypes: ['txt2img'],
    dateRange: 'week',
    favoritesOnly: true,
    collectionId: null,
    minSteps: 10,
    maxSteps: 30,
    minCfg: 4,
    maxCfg: 8,
    pinnedOnly: true,
    showIntermediates: true,
    showGrids: true,
    sortOption: 'name_asc',
    matchModes: {
        loras: 'all',
        controlNets: 'all',
    },
    assetFilterAliases: {
        loras: {
            'lora-a': ['lora-a', 'lora_a']
        }
    },
};

describe('filterState', () => {
    it('clears all non-view filters when selecting a collection', () => {
        const nextFilters = createCollectionSelectionFilters(activeFilters, 'collection-1');

        expect(nextFilters).toMatchObject({
            searchQuery: '',
            models: [],
            tools: [],
            loras: [],
            embeddings: [],
            hypernetworks: [],
            controlNets: [],
            ipAdapters: [],
            samplers: [],
            generationTypes: [],
            dateRange: 'all',
            favoritesOnly: false,
            pinnedOnly: false,
            collectionId: 'collection-1',
        });
        expect(nextFilters.minSteps).toBeUndefined();
        expect(nextFilters.maxSteps).toBeUndefined();
        expect(nextFilters.minCfg).toBeUndefined();
        expect(nextFilters.maxCfg).toBeUndefined();
        expect(nextFilters.matchModes).toBeUndefined();
        expect(nextFilters.assetFilterAliases).toBeUndefined();
    });

    it('preserves view state and clears optional filters when merged by the store', () => {
        const nextFilters = createCollectionSelectionFilters(activeFilters, 'collection-1');
        const mergedFilters = { ...activeFilters, ...nextFilters };

        expect(mergedFilters.showIntermediates).toBe(true);
        expect(mergedFilters.showGrids).toBe(true);
        expect(mergedFilters.sortOption).toBe('name_asc');
        expect(mergedFilters.minSteps).toBeUndefined();
        expect(mergedFilters.maxSteps).toBeUndefined();
        expect(mergedFilters.minCfg).toBeUndefined();
        expect(mergedFilters.maxCfg).toBeUndefined();
        expect(mergedFilters.matchModes).toBeUndefined();
        expect(mergedFilters.assetFilterAliases).toBeUndefined();
    });
});

import { describe, expect, it, vi } from 'vitest';
import { GeneratorTool, type FilterState } from '../../types';
import { parseAndApplyFilter } from '../filterUtils';

const createFilters = (): FilterState => ({
    searchQuery: '',
    models: [],
    tools: [GeneratorTool.COMFYUI],
    loras: [],
    embeddings: [],
    hypernetworks: [],
    samplers: [],
    generationTypes: [],
    controlNets: [],
    ipAdapters: [],
    dateRange: 'all',
    favoritesOnly: false,
    collectionId: null,
});

const applyTerm = (term: string, initial = createFilters()) => {
    let filters = initial;
    const setFilters = vi.fn((update: (previous: FilterState) => FilterState) => {
        filters = update(filters);
    });
    parseAndApplyFilter(term, setFilters);
    return { filters, setFilters };
};

describe('parseAndApplyFilter', () => {
    it('ignores empty and prefix-only terms', () => {
        expect(applyTerm('').setFilters).not.toHaveBeenCalled();
        expect(applyTerm('lora:   ').setFilters).not.toHaveBeenCalled();
        expect(applyTerm('model: ').setFilters).not.toHaveBeenCalled();
    });

    it('adds unique trimmed LoRA and model filters', () => {
        const lora = applyTerm('lora: detail enhancer');
        expect(lora.filters.loras).toEqual(['detail enhancer']);
        expect(applyTerm('lora: detail enhancer', lora.filters).filters.loras).toEqual(['detail enhancer']);

        const model = applyTerm('model: flux-dev');
        expect(model.filters.models).toEqual(['flux-dev']);
        expect(applyTerm('model: flux-dev', model.filters).filters.models).toEqual(['flux-dev']);
    });

    it('appends tool terms to an existing query and replaces plain searches', () => {
        expect(applyTerm('tool:comfyui').filters.searchQuery).toBe('tool:comfyui');
        expect(applyTerm('tool:invokeai', { ...createFilters(), searchQuery: 'portrait' }).filters.searchQuery)
            .toBe('portrait tool:invokeai');
        expect(applyTerm('new prompt', { ...createFilters(), searchQuery: 'old' }).filters.searchQuery)
            .toBe('new prompt');
    });
});

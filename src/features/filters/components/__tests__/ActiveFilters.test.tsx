import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Collection, FilterState, GeneratorTool } from '../../../../types';
import { ActiveFilters } from '../ActiveFilters';

const searchMocks = vi.hoisted(() => ({
    state: null as unknown as {
        filters: FilterState;
        setFilters: React.Dispatch<React.SetStateAction<FilterState>>;
        clearAllFilters: () => void;
    },
    setFilters: vi.fn(),
    clearAllFilters: vi.fn(),
}));

const collectionMocks = vi.hoisted(() => ({
    state: { collections: [] as Collection[], smartCollections: [] as Collection[] },
}));

vi.mock('../../../../contexts/SearchContext', () => ({
    useSearch: () => searchMocks.state,
}));

vi.mock('../../../../contexts/CollectionContext', () => ({
    useCollections: () => collectionMocks.state,
}));

vi.mock('../../../../utils/dateFilters', () => ({
    getDateFilterLabel: (filters: FilterState) => filters.dateRange === 'all' ? null : `Date:${filters.dateRange}`,
}));

const createFilters = (overrides: Partial<FilterState> = {}): FilterState => ({
    searchQuery: '',
    models: [],
    tools: [],
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
    ...overrides,
});

const createCollection = (overrides: Partial<Collection> = {}): Collection => ({
    id: 'collection-1',
    name: 'Collection',
    imageIds: [],
    createdAt: 1,
    ...overrides,
});

const applyLatestFilterUpdate = (filters: FilterState): FilterState => {
    const update = searchMocks.setFilters.mock.calls.at(-1)?.[0] as React.SetStateAction<FilterState> | undefined;
    if (!update) throw new Error('setFilters was not called');
    return typeof update === 'function' ? update(filters) : update;
};

const clickChipButton = (element: HTMLElement) => {
    const button = element.querySelector('button');
    if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing remove button for ${element.textContent}`);
    fireEvent.click(button);
};

const ActiveFiltersUnderTest = () => (
    <ActiveFilters
        filters={searchMocks.state.filters}
        setFilters={searchMocks.setFilters}
        clearAllFilters={searchMocks.clearAllFilters}
    />
);

describe('ActiveFilters', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        searchMocks.state = {
            filters: createFilters(),
            setFilters: searchMocks.setFilters,
            clearAllFilters: searchMocks.clearAllFilters,
        };
        collectionMocks.state.collections = [];
        collectionMocks.state.smartCollections = [];
    });

    it('renders nothing when neither explicit nor collection filters are active', () => {
        const { container } = render(<ActiveFiltersUnderTest />);
        expect(container.innerHTML).toBe('');
    });

    it('recognizes every explicit filter category as active', () => {
        const variants: Partial<FilterState>[] = [
            { dateRange: 'today' },
            { favoritesOnly: true },
            { models: ['model'] },
            { tools: [GeneratorTool.COMFYUI] },
            { loras: ['lora'] },
            { embeddings: ['embedding'] },
            { hypernetworks: ['hyper'] },
            { samplers: ['Euler'] },
            { generationTypes: ['txt2img'] },
            { minSteps: 1 },
            { maxSteps: 20 },
            { minCfg: 1 },
            { maxCfg: 8 },
            { controlNets: ['control'] },
            { ipAdapters: ['adapter'] },
        ];

        for (const variant of variants) {
            cleanup();
            searchMocks.state.filters = createFilters(variant);
            render(<ActiveFiltersUnderTest />);
            expect(screen.getByRole('button', { name: /clear all/i })).toBeTruthy();
        }

        cleanup();
        collectionMocks.state.collections = [createCollection({ id: 'regular' })];
        searchMocks.state.filters = createFilters({ collectionId: 'regular' });
        render(<ActiveFiltersUnderTest />);
        expect(screen.getByRole('button', { name: /clear all/i })).toBeTruthy();
    });

    it('does not render a second filter strip for a navbar-query-only search', () => {
        searchMocks.state.filters = createFilters({ searchQuery: 'query' });
        const { container } = render(<ActiveFiltersUnderTest />);
        expect(container.innerHTML).toBe('');
    });

    it('renders locked smart rules and deduplicates matching explicit chips', () => {
        const smartFilters = createFilters({
            searchQuery: 'smart search',
            models: ['smart-model'],
            tools: [GeneratorTool.FORGE],
            loras: ['smart-lora'],
            embeddings: ['smart-embedding'],
            hypernetworks: ['smart-hyper'],
            samplers: ['smart-sampler'],
            generationTypes: ['img2img'],
            controlNets: ['smart-control'],
            ipAdapters: ['smart-adapter'],
            dateRange: 'week',
            minSteps: 2,
            maxSteps: 40,
            minCfg: 3,
            maxCfg: 9,
        });
        collectionMocks.state.smartCollections = [
            createCollection({ id: 'smart', name: 'Smart', filters: smartFilters }),
        ];
        searchMocks.state.filters = createFilters({
            collectionId: 'smart',
            models: ['smart-model', 'manual-model', 'manual-model'],
            tools: [GeneratorTool.FORGE, GeneratorTool.COMFYUI, GeneratorTool.COMFYUI],
            loras: ['smart-lora', 'manual-lora', 'manual-lora'],
            embeddings: ['smart-embedding', 'manual-embedding', 'manual-embedding'],
            hypernetworks: ['smart-hyper', 'manual-hyper', 'manual-hyper'],
            samplers: ['smart-sampler', 'manual-sampler', 'manual-sampler'],
            generationTypes: ['img2img', 'txt2img', 'txt2img'],
            controlNets: ['smart-control', 'manual-control', 'manual-control'],
            ipAdapters: ['smart-adapter', 'manual-adapter', 'manual-adapter'],
        });

        render(<ActiveFiltersUnderTest />);

        expect(screen.getByTitle('Smart Rule: smart-model')).toBeTruthy();
        expect(screen.getByText(/smart search/)).toBeTruthy();
        expect(screen.getByText('Date:week')).toBeTruthy();
        expect(screen.getByText('Steps: 2-40')).toBeTruthy();
        expect(screen.getByText('CFG: 3-9')).toBeTruthy();
        expect(screen.getAllByText('smart-model')).toHaveLength(1);
        expect(screen.getAllByTitle('manual-model')).toHaveLength(1);
        expect(screen.getAllByTitle('manual-lora')).toHaveLength(1);
        expect(screen.getAllByTitle('manual-embedding')).toHaveLength(1);
        expect(screen.getAllByTitle('manual-hyper')).toHaveLength(1);
        expect(screen.getAllByTitle('manual-sampler')).toHaveLength(1);
        expect(screen.getAllByTitle('txt2img')).toHaveLength(1);
        expect(screen.getAllByTitle('manual-control')).toHaveLength(1);
        expect(screen.getAllByTitle('manual-adapter')).toHaveLength(1);
    });

    it('removes each explicit list filter through a functional state update', () => {
        const filters = createFilters({
            models: ['keep-model', 'remove-model'],
            tools: [GeneratorTool.FORGE, GeneratorTool.COMFYUI],
            loras: ['keep-lora', 'remove-lora'],
            embeddings: ['keep-embedding', 'remove-embedding'],
            hypernetworks: ['keep-hyper', 'remove-hyper'],
            samplers: ['keep-sampler', 'remove-sampler'],
            generationTypes: ['img2img', 'txt2img'],
            controlNets: ['keep-control', 'remove-control'],
            ipAdapters: ['keep-adapter', 'remove-adapter'],
        });
        searchMocks.state.filters = filters;
        render(<ActiveFiltersUnderTest />);

        const cases: Array<{ title: string; field: keyof FilterState; removed: string }> = [
            { title: 'remove-model', field: 'models', removed: 'remove-model' },
            { title: GeneratorTool.COMFYUI, field: 'tools', removed: GeneratorTool.COMFYUI },
            { title: 'remove-lora', field: 'loras', removed: 'remove-lora' },
            { title: 'remove-embedding', field: 'embeddings', removed: 'remove-embedding' },
            { title: 'remove-hyper', field: 'hypernetworks', removed: 'remove-hyper' },
            { title: 'remove-sampler', field: 'samplers', removed: 'remove-sampler' },
            { title: 'txt2img', field: 'generationTypes', removed: 'txt2img' },
            { title: 'remove-control', field: 'controlNets', removed: 'remove-control' },
            { title: 'remove-adapter', field: 'ipAdapters', removed: 'remove-adapter' },
        ];

        for (const { title, field, removed } of cases) {
            searchMocks.setFilters.mockClear();
            clickChipButton(screen.getByTitle(title));
            const usesLegacyArrayFallback = ['samplers', 'generationTypes', 'controlNets', 'ipAdapters'].includes(field);
            const next = applyLatestFilterUpdate(filters);
            expect(next[field]).not.toContain(removed);
            const updateBase = usesLegacyArrayFallback
                ? { ...filters, [field]: undefined } as unknown as FilterState
                : filters;
            const legacyNext = applyLatestFilterUpdate(updateBase);
            expect(legacyNext[field]).not.toContain(removed);
        }
    });

    it('clears date, favorite, numeric ranges, and all filters', () => {
        const filters = createFilters({
            dateRange: 'custom',
            dateFrom: '2025-01-01',
            dateTo: '2025-02-01',
            favoritesOnly: true,
            minSteps: 3,
            maxSteps: 30,
            minCfg: 2,
            maxCfg: 8,
        });
        searchMocks.state.filters = filters;
        render(<ActiveFiltersUnderTest />);

        clickChipButton(screen.getByText('Date:custom').parentElement as HTMLElement);
        expect(applyLatestFilterUpdate(filters)).toMatchObject({
            dateRange: 'all',
            dateFrom: undefined,
            dateTo: undefined,
        });

        searchMocks.setFilters.mockClear();
        clickChipButton(screen.getByText('Favorites').parentElement as HTMLElement);
        expect(applyLatestFilterUpdate(filters).favoritesOnly).toBe(false);

        searchMocks.setFilters.mockClear();
        clickChipButton(screen.getByText('Steps: 3-30').parentElement as HTMLElement);
        expect(applyLatestFilterUpdate(filters)).toMatchObject({ minSteps: undefined, maxSteps: undefined });

        searchMocks.setFilters.mockClear();
        clickChipButton(screen.getByText('CFG: 2-8').parentElement as HTMLElement);
        expect(applyLatestFilterUpdate(filters)).toMatchObject({ minCfg: undefined, maxCfg: undefined });

        fireEvent.click(screen.getByRole('button', { name: /clear all/i }));
        expect(searchMocks.clearAllFilters).toHaveBeenCalledOnce();
    });

    it('uses empty-array and open-ended range fallbacks safely', () => {
        searchMocks.state.filters = createFilters({
            samplers: undefined as unknown as string[],
            generationTypes: undefined as unknown as string[],
            controlNets: undefined as unknown as string[],
            ipAdapters: undefined as unknown as string[],
            minSteps: 4,
            maxCfg: 7,
        });
        render(<ActiveFiltersUnderTest />);

        expect(screen.getByText(/Steps: 4-/)).toBeTruthy();
        expect(screen.getByText(/CFG: 0-7/)).toBeTruthy();
    });

    it('renders smart collections with sparse optional rule arrays and open ranges', () => {
        const sparseRules = {
            ...createFilters(),
            models: undefined,
            tools: undefined,
            loras: undefined,
            embeddings: undefined,
            hypernetworks: undefined,
            samplers: undefined,
            generationTypes: undefined,
            controlNets: undefined,
            ipAdapters: undefined,
            maxSteps: 25,
            minCfg: 5,
        } as unknown as FilterState;
        collectionMocks.state.smartCollections = [
            createCollection({ id: 'sparse', filters: sparseRules }),
        ];
        searchMocks.state.filters = createFilters({ collectionId: 'sparse' });

        const { rerender } = render(<ActiveFiltersUnderTest />);

        expect(screen.getByText(/Steps: 0-25/)).toBeTruthy();
        expect(screen.getByText(/CFG: 5-/)).toBeTruthy();

        const inverseSparseRules = {
            ...sparseRules,
            minSteps: 5,
            maxSteps: undefined,
            minCfg: undefined,
            maxCfg: 6,
        } as unknown as FilterState;
        collectionMocks.state.smartCollections = [
            createCollection({ id: 'inverse-sparse', filters: inverseSparseRules }),
        ];
        searchMocks.state.filters = createFilters({ collectionId: 'inverse-sparse' });
        rerender(<ActiveFiltersUnderTest />);

        expect(screen.getByText(/Steps: 5-/)).toBeTruthy();
        expect(screen.getByText(/CFG: 0-6/)).toBeTruthy();
    });
});

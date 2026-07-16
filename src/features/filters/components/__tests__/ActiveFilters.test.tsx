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
    pinnedOnly: false,
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

    it('renders a named chip for every explicit filter category', () => {
        const variants: Array<{ filters: Partial<FilterState>; label: string | RegExp }> = [
            { filters: { dateRange: 'today' }, label: 'Date:today' },
            { filters: { favoritesOnly: true }, label: 'Favorites' },
            { filters: { pinnedOnly: true }, label: 'Pinned' },
            { filters: { models: ['model'] }, label: 'model' },
            { filters: { tools: [GeneratorTool.COMFYUI] }, label: GeneratorTool.COMFYUI },
            { filters: { loras: ['lora'] }, label: 'lora' },
            { filters: { embeddings: ['embedding'] }, label: 'embedding' },
            { filters: { hypernetworks: ['hyper'] }, label: 'hyper' },
            { filters: { searchQuery: 'query' }, label: 'Search: "query"' },
            { filters: { samplers: ['Euler'] }, label: 'Euler' },
            { filters: { generationTypes: ['txt2img'] }, label: 'txt2img' },
            { filters: { minSteps: 1 }, label: /Steps: 1-/ },
            { filters: { maxSteps: 20 }, label: 'Steps: 0-20' },
            { filters: { minCfg: 1 }, label: /CFG: 1-/ },
            { filters: { maxCfg: 8 }, label: 'CFG: 0-8' },
            { filters: { controlNets: ['control'] }, label: 'control' },
            { filters: { ipAdapters: ['adapter'] }, label: 'adapter' },
        ];

        for (const variant of variants) {
            cleanup();
            searchMocks.state.filters = createFilters(variant.filters);
            render(<ActiveFiltersUnderTest />);
            expect(screen.getByText(variant.label)).toBeTruthy();
        }

        cleanup();
        collectionMocks.state.collections = [createCollection({ id: 'regular' })];
        searchMocks.state.filters = createFilters({ collectionId: 'regular' });
        render(<ActiveFiltersUnderTest />);
        expect(screen.getByText('Collection: Collection')).toBeTruthy();
    });

    it('clears search, collection, and pinned chips without changing unrelated criteria', () => {
        const filters = createFilters({
            searchQuery: 'portrait',
            collectionId: 'regular',
            pinnedOnly: true,
            favoritesOnly: true,
        });
        collectionMocks.state.collections = [createCollection({ id: 'regular', name: 'Portraits' })];
        searchMocks.state.filters = filters;
        render(<ActiveFiltersUnderTest />);

        fireEvent.click(screen.getByRole('button', { name: 'Clear Search Filter' }));
        expect(applyLatestFilterUpdate(filters)).toMatchObject({
            searchQuery: '',
            collectionId: 'regular',
            pinnedOnly: true,
            favoritesOnly: true,
        });

        searchMocks.setFilters.mockClear();
        fireEvent.click(screen.getByRole('button', { name: 'Clear Collection Filter Portraits' }));
        expect(applyLatestFilterUpdate(filters)).toMatchObject({
            searchQuery: 'portrait',
            collectionId: null,
            pinnedOnly: true,
            favoritesOnly: true,
        });

        searchMocks.setFilters.mockClear();
        fireEvent.click(screen.getByRole('button', { name: 'Clear Pinned Filter' }));
        expect(applyLatestFilterUpdate(filters)).toMatchObject({
            searchQuery: 'portrait',
            collectionId: 'regular',
            pinnedOnly: false,
            favoritesOnly: true,
        });
    });

    it('keeps stale collection state recoverable and ignores whitespace-only searches', () => {
        searchMocks.state.filters = createFilters({ collectionId: 'missing' });
        const { rerender } = render(<ActiveFiltersUnderTest />);

        expect(screen.getByText('Collection unavailable')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Clear Unavailable Collection Filter' }));
        expect(applyLatestFilterUpdate(searchMocks.state.filters).collectionId).toBeNull();

        searchMocks.state.filters = createFilters({ searchQuery: '   ' });
        rerender(<ActiveFiltersUnderTest />);
        expect(screen.queryByRole('button', { name: /clear all/i })).toBeNull();
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
            favoritesOnly: true,
            pinnedOnly: true,
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
            searchQuery: 'smart search',
            favoritesOnly: true,
            pinnedOnly: true,
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
        expect(screen.getByText('Favorites').parentElement?.getAttribute('title')).toBe('Smart Collection Rule');
        expect(screen.getByText('Pinned').parentElement?.getAttribute('title')).toBe('Smart Collection Rule');
        expect(screen.queryByRole('button', { name: 'Clear Search Filter' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Clear Favorites Filter' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Clear Pinned Filter' })).toBeNull();
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

    it('keeps a manual search chip when it adds a different smart-collection criterion', () => {
        collectionMocks.state.smartCollections = [
            createCollection({
                id: 'smart',
                name: 'Smart',
                filters: createFilters({ searchQuery: 'smart search' }),
            }),
        ];
        searchMocks.state.filters = createFilters({
            collectionId: 'smart',
            searchQuery: 'manual search',
        });

        render(<ActiveFiltersUnderTest />);

        expect(screen.getByText('"smart search"')).toBeTruthy();
        expect(screen.getByText('Search: "manual search"')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Clear Search Filter' })).toBeTruthy();
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

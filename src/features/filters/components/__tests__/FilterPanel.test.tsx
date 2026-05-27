import type { Dispatch, SetStateAction } from 'react';
import { fireEvent, render, screen } from '../../../../test/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Collection, FilterState, SmartCollection, SortOption, AssetScope } from '../../../../types';
import type { Facets } from '../../../../services/db/searchRepo';
import type { useCollections } from '../../../../contexts/CollectionContext';
import type { useSearch } from '../../../../contexts/SearchContext';
import type { ImagesQueryKey } from '../../../../hooks/useImagesQuery';
import { FilterPanel } from '../FilterPanel';

type SearchContextValue = ReturnType<typeof useSearch>;
type CollectionsContextValue = ReturnType<typeof useCollections>;

const contextMocks = vi.hoisted(() => ({
    search: { current: undefined as unknown },
    collections: { current: undefined as unknown }
}));

vi.mock('../../../../contexts/SearchContext', () => ({
    useSearch: () => contextMocks.search.current
}));

vi.mock('../../../../contexts/CollectionContext', () => ({
    useCollections: () => contextMocks.collections.current
}));

vi.mock('../../../../hooks/useAppVersion', () => ({
    useAppVersion: () => '0.0.0-test'
}));

vi.mock('../CollectionsSection', () => ({
    CollectionsSection: () => <div data-testid="collections-section" />
}));

vi.mock('../ResourceSection', () => ({
    ResourceSection: ({
        title,
        type,
        data,
        isLoading
    }: {
        title: string;
        type: string;
        data: { name: string }[];
        isLoading?: boolean;
    }) => (
        <section data-testid={`resource-section-${type}`}>
            <h3>{title}</h3>
            {isLoading ? (
                <p>Loading {title}...</p>
            ) : (
                <p>{data.map(item => item.name).join(', ')}</p>
            )}
        </section>
    )
}));

const filters: FilterState = {
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
    collectionId: null
};

const emptyFacets = (): Facets => ({
    checkpoints: [],
    loras: [],
    embeddings: [],
    hypernetworks: [],
    controlNets: [],
    ipAdapters: [],
    tools: []
});

const defaultSearchContext = (overrides: Partial<SearchContextValue> = {}): SearchContextValue => ({
    images: [],
    imagesQueryKey: ['images', filters, 'date_desc', false, 'blur', [], null] as ImagesQueryKey,
    setImages: vi.fn() as Dispatch<SetStateAction<SearchContextValue['images']>>,
    filters,
    setFilters: vi.fn() as Dispatch<SetStateAction<FilterState>>,
    sortOption: 'date_desc' as SortOption,
    setSortOption: vi.fn() as Dispatch<SetStateAction<SortOption>>,
    facets: emptyFacets(),
    stats: {
        totalImages: 0,
        totalGenerations: 0,
        avgSteps: 0,
        estSizeMB: '0',
        modelStats: [],
        keywordStats: []
    },
    totalImages: 0,
    globalTotal: 0,
    hasMoreImages: false,
    loadMoreImages: async () => { },
    clearAllFilters: vi.fn(),
    isFiltering: false,
    activeSqlWhere: '',
    activeSqlParams: [],
    refreshMetadata: async () => { },
    fetchData: async () => { },
    recentSearches: [],
    setRecentSearches: vi.fn() as Dispatch<SetStateAction<string[]>>,
    toggleFavorite: async () => { },
    togglePin: async () => { },
    availableHiddenContent: { hasIntermediates: false, hasGrids: false },
    refreshHiddenAvailability: async () => { },
    isFacetsLoading: false,
    isLoadingMore: false,
    isStatsSummaryLoading: false,
    isKeywordStatsLoading: false,
    validFacetNames: null,
    assetScope: 'local',
    setAssetScope: vi.fn() as Dispatch<SetStateAction<AssetScope>>,
    setFacetDrilldownActive: vi.fn(),
    ...overrides
});

const defaultCollectionsContext = (): CollectionsContextValue => ({
    collections: [],
    setCollections: vi.fn() as Dispatch<SetStateAction<Collection[]>>,
    smartCollections: [],
    setSmartCollections: vi.fn() as Dispatch<SetStateAction<SmartCollection[]>>,
    setAllCollections: vi.fn() as Dispatch<SetStateAction<Collection[]>>,
    refreshCollections: async () => { },
    refreshCollectionThumbnails: async () => { },
    isLoaded: true
});

const renderResourcesTab = (searchOverrides: Partial<SearchContextValue> = {}) => {
    contextMocks.search.current = defaultSearchContext(searchOverrides);
    contextMocks.collections.current = defaultCollectionsContext();

    render(
        <FilterPanel
            filters={filters}
            setFilters={vi.fn() as Dispatch<SetStateAction<FilterState>>}
            onCreateCollection={vi.fn()}
            onSaveSmartCollection={vi.fn()}
            onDeleteSmartCollection={vi.fn()}
        />
    );

    fireEvent.click(screen.getByRole('button', { name: /^Assets$/ }));
};

describe('FilterPanel local asset scope', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('keeps resource loading states visible instead of showing the empty CTA while local facets fetch', () => {
        renderResourcesTab({ isFacetsLoading: true });

        expect(screen.queryByText('No local resource folders scanned yet.')).toBeNull();
        expect(screen.getByTestId('resource-section-checkpoints')).toBeTruthy();
        expect(screen.getByText('Loading Checkpoints...')).toBeTruthy();
        expect(screen.getByText('Loading Resources (LoRA)...')).toBeTruthy();
    });

    it('shows the empty CTA after local facets settle without local disk assets', () => {
        renderResourcesTab({ isFacetsLoading: false });

        expect(screen.getByText('No local resource folders scanned yet.')).toBeTruthy();
        expect(screen.queryByTestId('resource-section-checkpoints')).toBeNull();
    });

    it('shows resource lists and hides the empty CTA when local disk assets exist', () => {
        const facets = emptyFacets();
        facets.checkpoints = [{
            name: 'LocalCheckpoint',
            count: 0,
            isLocalDisk: true
        }];

        renderResourcesTab({ facets, isFacetsLoading: false });

        expect(screen.queryByText('No local resource folders scanned yet.')).toBeNull();
        expect(screen.getByTestId('resource-section-checkpoints')).toBeTruthy();
        expect(screen.getByText('LocalCheckpoint')).toBeTruthy();
    });
});

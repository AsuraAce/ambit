import type { Dispatch, SetStateAction } from 'react';
import { fireEvent, render, screen } from '../../../../test/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GeneratorTool, type Collection, type FilterState, type SmartCollection, type SortOption, type AssetScope } from '../../../../types';
import type { Facets } from '../../../../services/db/searchRepo';
import type { useCollections } from '../../../../contexts/CollectionContext';
import type { useSearch } from '../../../../contexts/SearchContext';
import type { ImagesQueryKey } from '../../../../hooks/useImagesQuery';
import { FilterPanel } from '../FilterPanel';
import { openExternalUrl } from '../../../../utils/externalLinks';

type SearchContextValue = ReturnType<typeof useSearch>;
type CollectionsContextValue = ReturnType<typeof useCollections>;

const contextMocks = vi.hoisted(() => ({
    search: { current: undefined as unknown },
    collections: { current: undefined as unknown },
    childProps: {} as Record<string, Record<string, unknown>>,
    appVersion: { current: '0.0.0-test' as string | null }
}));

vi.mock('../../../../contexts/SearchContext', () => ({
    useSearch: () => contextMocks.search.current
}));

vi.mock('../../../../contexts/CollectionContext', () => ({
    useCollections: () => contextMocks.collections.current
}));

vi.mock('../../../../hooks/useAppVersion', () => ({
    useAppVersion: () => contextMocks.appVersion.current
}));

vi.mock('../../../../utils/externalLinks', () => ({
    openExternalUrl: vi.fn()
}));

vi.mock('../CollectionsSection', () => ({
    CollectionsSection: (props: Record<string, unknown>) => {
        contextMocks.childProps.collections = props;
        return <button data-testid="collections-section" onClick={() => (props.onToggle as () => void)()}>collections</button>;
    }
}));

vi.mock('../GeneratorSection', () => ({
    GeneratorSection: (props: Record<string, unknown>) => {
        contextMocks.childProps.generator = props;
        return <button data-testid="generator-section" onClick={() => (props.onToggle as () => void)()}>generator</button>;
    }
}));

vi.mock('../ParameterSection', () => ({
    ParameterSection: (props: Record<string, unknown>) => {
        contextMocks.childProps.parameter = props;
        return <button data-testid="parameter-section" onClick={() => (props.onToggle as () => void)()}>parameter</button>;
    }
}));

vi.mock('../GuidanceSection', () => ({
    GuidanceSection: (props: Record<string, unknown>) => {
        contextMocks.childProps.guidance = props;
        return <button data-testid="guidance-section" onClick={() => (props.onToggle as () => void)()}>guidance</button>;
    }
}));

vi.mock('../DateRangeSection', () => ({
    DateRangeSection: (props: Record<string, unknown>) => {
        contextMocks.childProps.date = props;
        return <div data-testid="date-section">date</div>;
    }
}));

vi.mock('../ResourceSection', () => ({
    ResourceSection: (props: {
        title: string;
        type: string;
        data: { name: string }[];
        isLoading?: boolean;
    }) => {
        contextMocks.childProps[props.type] = props as unknown as Record<string, unknown>;
        return (
        <section data-testid={`resource-section-${props.type}`} onClick={() => (props as Record<string, unknown>).onToggle && ((props as Record<string, unknown>).onToggle as () => void)()}>
            <h3>{props.title}</h3>
            {props.isLoading ? (
                <p>Loading {props.title}...</p>
            ) : (
                <p>{props.data.map(item => item.name).join(', ')}</p>
            )}
        </section>
        );
    }
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
    privacyExposureBlocked: false,
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

interface RenderPanelOptions {
    search?: Partial<SearchContextValue>;
    collections?: Collection[];
    smartCollections?: SmartCollection[];
    props?: Partial<React.ComponentProps<typeof FilterPanel>>;
}

const renderPanel = ({ search, collections = [], smartCollections = [], props = {} }: RenderPanelOptions = {}) => {
    contextMocks.search.current = defaultSearchContext(search);
    contextMocks.collections.current = {
        ...defaultCollectionsContext(),
        collections,
        smartCollections
    };

    const panelProps: React.ComponentProps<typeof FilterPanel> = {
        filters,
        setFilters: vi.fn() as Dispatch<SetStateAction<FilterState>>,
        onCreateCollection: vi.fn(),
        onSaveSmartCollection: vi.fn(),
        onDeleteSmartCollection: vi.fn(),
        ...props
    };
    const result = render(<FilterPanel {...panelProps} />);
    return { ...result, panelProps };
};

const renderResourcesTab = (searchOverrides: Partial<SearchContextValue> = {}) => {
    renderPanel({ search: searchOverrides });

    fireEvent.click(screen.getByRole('button', { name: /^Assets$/ }));
};

describe('FilterPanel local asset scope', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        contextMocks.childProps = {};
        contextMocks.appVersion.current = '0.0.0-test';
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

    it('removes the collapsed panel from accessibility and keyboard interaction until reopened', () => {
        contextMocks.search.current = defaultSearchContext();
        contextMocks.collections.current = defaultCollectionsContext();
        const panelProps = {
            filters,
            setFilters: vi.fn() as Dispatch<SetStateAction<FilterState>>,
            onCreateCollection: vi.fn(),
            onSaveSmartCollection: vi.fn(),
            onDeleteSmartCollection: vi.fn()
        };
        const { container, rerender } = render(<FilterPanel {...panelProps} isVisible={false} />);
        const panel = container.firstElementChild as HTMLElement;

        expect(panel.hasAttribute('inert')).toBe(true);
        expect(panel.getAttribute('aria-hidden')).toBe('true');
        expect(screen.queryByRole('heading', { name: 'Library' })).toBeNull();

        rerender(<FilterPanel {...panelProps} isVisible />);

        expect(panel.hasAttribute('inert')).toBe(false);
        expect(panel.getAttribute('aria-hidden')).toBe('false');
        expect(screen.getByRole('heading', { name: 'Library' })).toBeTruthy();
    });
});

describe('FilterPanel interactions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        contextMocks.childProps = {};
        contextMocks.appVersion.current = '0.0.0-test';
    });

    it('coordinates tab facet loading and cleans it up on unmount', () => {
        const setFacetDrilldownActive = vi.fn();
        const { unmount } = renderPanel({ search: { setFacetDrilldownActive } });

        expect(setFacetDrilldownActive).toHaveBeenLastCalledWith(false);
        fireEvent.click(screen.getByRole('button', { name: /^Assets$/ }));
        expect(setFacetDrilldownActive).toHaveBeenLastCalledWith(true);
        fireEvent.click(screen.getByRole('button', { name: /^Filters$/ }));
        expect(screen.getByTestId('generator-section')).toBeTruthy();
        expect(screen.getByTestId('parameter-section')).toBeTruthy();
        expect(screen.getByTestId('guidance-section')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: /^Organize$/ }));
        expect(setFacetDrilldownActive).toHaveBeenLastCalledWith(false);

        unmount();
        expect(setFacetDrilldownActive).toHaveBeenLastCalledWith(false);
    });

    it('keeps drilldown disabled while the panel is hidden', () => {
        const setFacetDrilldownActive = vi.fn();
        const { container } = renderPanel({
            search: { setFacetDrilldownActive },
            props: { isVisible: false, className: 'custom-panel' }
        });

        fireEvent.click(screen.getByRole('button', { name: /^Assets$/, hidden: true }));
        expect(setFacetDrilldownActive).toHaveBeenLastCalledWith(false);
        expect(container.firstElementChild?.className).toContain('w-0');
        expect(container.firstElementChild?.className).toContain('custom-panel');
    });

    it('passes collection callbacks through and toggles section expansion', () => {
        const collection = { id: 'regular', name: 'Regular' } as Collection;
        const smart = { id: 'smart', name: 'Smart', filters } as SmartCollection;
        const onEditCollection = vi.fn();
        renderPanel({ collections: [collection], smartCollections: [smart], props: { onEditCollection } });

        const initial = contextMocks.childProps.collections;
        expect(initial.collections).toEqual([collection, smart]);
        expect(initial.isOpen).toBe(true);
        expect(initial.onEditCollection).toBe(onEditCollection);

        fireEvent.click(screen.getByTestId('collections-section'));
        expect(contextMocks.childProps.collections.isOpen).toBe(false);
    });

    it('switches asset scopes and applies scope-specific visibility and valid names', () => {
        const setAssetScope = vi.fn();
        const facets = emptyFacets();
        facets.embeddings = [{ name: 'used-embedding', count: 1 }];
        facets.hypernetworks = [{ name: 'local-hypernet', count: 0, isLocalDisk: true }];
        facets.controlNets = [{ name: 'both-control', count: 1, isLocalDisk: true }];
        facets.ipAdapters = [{ name: 'unused-ip', count: 0, isLocalDisk: false }];

        renderResourcesTab({
            assetScope: 'used',
            setAssetScope,
            facets,
            validFacetNames: {
                checkpoints: ['checkpoint'],
                loras: ['lora'],
                embeddings: ['used-embedding'],
                hypernetworks: ['local-hypernet'],
                controlNets: ['both-control'],
                ipAdapters: ['unused-ip'],
                tools: []
            }
        });

        expect(screen.getByTestId('resource-section-embeddings')).toBeTruthy();
        expect(screen.queryByTestId('resource-section-hypernetworks')).toBeNull();
        expect(screen.getByTestId('resource-section-controlNets')).toBeTruthy();
        expect(screen.queryByTestId('resource-section-ipAdapters')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'All Assets' }));
        fireEvent.click(screen.getByRole('button', { name: 'Local on Disk' }));
        expect(setAssetScope).toHaveBeenNthCalledWith(1, 'all');
        expect(setAssetScope).toHaveBeenNthCalledWith(2, 'local');
    });

    it('shows and toggles every resource section in all-assets scope', () => {
        const facets = emptyFacets();
        facets.checkpoints = [{ name: 'checkpoint', count: 1 }];
        facets.loras = [{ name: 'lora', count: 0, isLocalDisk: true }];
        facets.embeddings = [{ name: 'embedding', count: 1, isLocalDisk: false }];
        facets.hypernetworks = [{ name: 'hypernet', count: 0, isLocalDisk: true }];
        facets.controlNets = [{ name: 'control', count: 1, isLocalDisk: true }];
        facets.ipAdapters = [{ name: 'adapter', count: 0, isLocalDisk: true }];
        renderResourcesTab({ assetScope: 'all', facets });

        for (const type of ['checkpoints', 'loras', 'embeddings', 'hypernetworks', 'controlNets', 'ipAdapters']) {
            expect(contextMocks.childProps[type].isOpen).toBe(type === 'checkpoints' || type === 'loras');
            fireEvent.click(screen.getByTestId(`resource-section-${type}`));
            expect(contextMocks.childProps[type].isOpen).toBe(type !== 'checkpoints' && type !== 'loras');
            expect(contextMocks.childProps[type].validNames).toBeNull();
        }
    });

    it('evaluates local resource visibility against disk inventory entries', () => {
        const facets = emptyFacets();
        facets.embeddings = [{ name: 'local-embedding', count: 0, isLocalDisk: true }];
        renderResourcesTab({ assetScope: 'local', facets });
        expect(screen.getByTestId('resource-section-embeddings')).toBeTruthy();
    });

    it('toggles every generation section', () => {
        renderPanel();
        fireEvent.click(screen.getByRole('button', { name: /^Filters$/ }));

        for (const type of ['generator', 'parameter', 'guidance']) {
            expect(contextMocks.childProps[type].isOpen).toBe(true);
            fireEvent.click(screen.getByTestId(`${type}-section`));
            expect(contextMocks.childProps[type].isOpen).toBe(false);
        }
    });

    it('opens resource settings from the local empty state', () => {
        const onOpenResourceFolders = vi.fn();
        renderPanel({ props: { onOpenResourceFolders } });
        fireEvent.click(screen.getByRole('button', { name: /^Assets$/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Add Resource Folder' }));
        expect(onOpenResourceFolders).toHaveBeenCalledOnce();
    });

    it('clears dirty filters and opens the project repository', () => {
        const clearAllFilters = vi.fn();
        renderPanel({
            search: { filters: { ...filters, collectionId: 'regular' }, clearAllFilters }
        });

        fireEvent.click(screen.getByRole('button', { name: 'Reset All' }));
        fireEvent.click(screen.getByRole('button', { name: 'Open Ambit on GitHub' }));
        expect(clearAllFilters).toHaveBeenCalledOnce();
        expect(openExternalUrl).toHaveBeenCalledOnce();
        expect(screen.getByText('v0.0.0-test')).toBeTruthy();
    });

    it('merges manual filters into a smart collection and clears transient edits', () => {
        const setFilters = vi.fn();
        const onUpdateCollectionFilters = vi.fn();
        const saved: FilterState = {
            ...filters,
            searchQuery: 'saved',
            models: ['base-model'],
            tools: [GeneratorTool.COMFYUI],
            dateRange: 'all',
            favoritesOnly: true,
            showGrids: true,
            showIntermediates: true
        };
        const manual: FilterState = {
            ...filters,
            collectionId: 'smart',
            searchQuery: 'manual',
            models: ['base-model', 'new-model'],
            tools: [GeneratorTool.INVOKEAI],
            loras: ['lora'],
            embeddings: ['embedding'],
            hypernetworks: ['hypernet'],
            controlNets: ['control'],
            ipAdapters: ['adapter'],
            dateRange: 'custom',
            dateFrom: '2026-01-01',
            dateTo: '2026-01-31',
            favoritesOnly: false,
            pinnedOnly: true,
            minSteps: 10,
            maxSteps: 20,
            minCfg: 4,
            maxCfg: 8
        };
        const smart = { id: 'smart', name: 'Smart', filters: saved } as SmartCollection;
        renderPanel({
            search: { filters: manual, setFilters },
            smartCollections: [smart],
            props: { onUpdateCollectionFilters }
        });

        fireEvent.click(screen.getByRole('button', { name: 'Update' }));
        expect(onUpdateCollectionFilters).toHaveBeenCalledWith('smart', expect.objectContaining({
            collectionId: null,
            searchQuery: 'saved manual',
            models: ['base-model', 'new-model'],
            tools: [GeneratorTool.COMFYUI, GeneratorTool.INVOKEAI],
            loras: ['lora'],
            dateRange: 'custom',
            favoritesOnly: true,
            pinnedOnly: true,
            showGrids: true,
            showIntermediates: true
        }));
        const updater = setFilters.mock.calls[0][0] as (value: FilterState) => FilterState;
        expect(updater(manual)).toEqual(expect.objectContaining({
            collectionId: 'smart',
            searchQuery: '',
            models: [],
            dateRange: 'all',
            pinnedOnly: false
        }));
    });

    it('falls back to saving the active smart collection when no updater is provided', () => {
        const onSaveSmartCollection = vi.fn();
        const manual = { ...filters, collectionId: 'smart', searchQuery: 'manual' };
        const smart = { id: 'smart', name: 'Smart', filters } as SmartCollection;
        renderPanel({
            search: { filters: manual },
            smartCollections: [smart],
            props: { onSaveSmartCollection }
        });

        fireEvent.click(screen.getByRole('button', { name: 'Update' }));
        expect(onSaveSmartCollection).toHaveBeenCalledWith('Smart', manual);
    });

    it('preserves saved scalar and date rules when manual edits do not replace them', () => {
        const onUpdateCollectionFilters = vi.fn();
        const saved: FilterState = {
            ...filters,
            pinnedOnly: true,
            minSteps: 1,
            maxSteps: 2,
            minCfg: 3,
            maxCfg: 4,
            dateRange: 'custom',
            dateFrom: '2025-01-01',
            dateTo: '2025-01-31'
        };
        const manual: FilterState = {
            ...filters,
            collectionId: 'smart',
            models: ['manual-model']
        };
        renderPanel({
            search: { filters: manual },
            smartCollections: [{ id: 'smart', name: 'Smart', filters: saved } as SmartCollection],
            props: { onUpdateCollectionFilters }
        });

        fireEvent.click(screen.getByRole('button', { name: 'Update' }));
        expect(onUpdateCollectionFilters).toHaveBeenCalledWith('smart', expect.objectContaining({
            searchQuery: '',
            dateRange: 'custom',
            dateFrom: '2025-01-01',
            dateTo: '2025-01-31',
            pinnedOnly: true,
            minSteps: 1,
            maxSteps: 2,
            minCfg: 3,
            maxCfg: 4
        }));
    });

    it('shows a version placeholder while app version discovery is pending', () => {
        contextMocks.appVersion.current = null;
        renderPanel();
        expect(screen.getByText('v...')).toBeTruthy();
    });
});

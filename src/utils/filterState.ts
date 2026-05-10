import { FilterState } from '../types';

type PreservedViewFilters = Pick<FilterState, 'showGrids' | 'showIntermediates' | 'sortOption'>;

export const createDefaultFilters = (
    overrides: Partial<FilterState> = {}
): FilterState => ({
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
    dateFrom: undefined,
    dateTo: undefined,
    favoritesOnly: false,
    collectionId: null,
    minSteps: undefined,
    maxSteps: undefined,
    minCfg: undefined,
    maxCfg: undefined,
    pinnedOnly: false,
    showIntermediates: false,
    showGrids: false,
    sortOption: undefined,
    matchModes: undefined,
    assetFilterAliases: undefined,
    ...overrides,
});

const hasRangeFilter = (value: number | null | undefined): boolean =>
    value !== undefined && value !== null;

export const hasActiveResultFilters = (filters: FilterState): boolean => (
    filters.searchQuery.trim().length > 0 ||
    filters.models.length > 0 ||
    filters.tools.length > 0 ||
    filters.loras.length > 0 ||
    filters.embeddings.length > 0 ||
    filters.hypernetworks.length > 0 ||
    filters.controlNets.length > 0 ||
    filters.ipAdapters.length > 0 ||
    filters.samplers.length > 0 ||
    filters.generationTypes.length > 0 ||
    filters.dateRange !== 'all' ||
    !!filters.dateFrom ||
    !!filters.dateTo ||
    filters.favoritesOnly ||
    !!filters.pinnedOnly ||
    !!filters.collectionId ||
    !!filters.showIntermediates ||
    !!filters.showGrids ||
    hasRangeFilter(filters.minSteps) ||
    hasRangeFilter(filters.maxSteps) ||
    hasRangeFilter(filters.minCfg) ||
    hasRangeFilter(filters.maxCfg)
);

export const shouldPrefetchResultPages = (
    filters: FilterState,
    hasNextPage: boolean,
    isFetchingNextPage: boolean,
    currentPageCount: number
): boolean => (
    !hasActiveResultFilters(filters) &&
    hasNextPage &&
    !isFetchingNextPage &&
    currentPageCount > 0 &&
    currentPageCount < 3
);

const preserveViewFilters = (filters: FilterState): PreservedViewFilters => ({
    showGrids: filters.showGrids,
    showIntermediates: filters.showIntermediates,
    sortOption: filters.sortOption,
});

export const createCollectionSelectionFilters = (
    previousFilters: FilterState,
    collectionId: string
): FilterState => createDefaultFilters({
    ...preserveViewFilters(previousFilters),
    collectionId,
});

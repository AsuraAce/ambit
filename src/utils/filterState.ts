import { FilterState, type ImageKindFilter, type MediaTypeFilter } from '../types';

type PreservedViewFilters = Pick<FilterState, 'showGrids' | 'showIntermediates' | 'showInvokeImageAssets' | 'sortOption'>;

export const normalizeImageKindFilter = (value: unknown): ImageKindFilter => (
    value === 'generated' || value === 'photograph' || value === 'other'
        ? value
        : 'all'
);

export const normalizeMediaTypeFilter = (
    value: unknown,
    legacyImageKind: unknown = 'all'
): MediaTypeFilter => (
    value === 'all' || value === 'image' || value === 'video'
        ? value
        : normalizeImageKindFilter(legacyImageKind) === 'all' ? 'all' : 'image'
);

/** Legacy saved collections may omit mediaType; explicit All media ignores kind. */
export const getEffectiveImageKind = (
    filters: Pick<FilterState, 'mediaType' | 'sourceKind'>
): ImageKindFilter => normalizeMediaTypeFilter(filters.mediaType, filters.sourceKind) === 'image'
    ? normalizeImageKindFilter(filters.sourceKind)
    : 'all';

/** Save effective constraints, not dormant browsing preferences. */
export const normalizeCollectionScope = (filters: FilterState): FilterState => ({
    ...filters,
    mediaType: normalizeMediaTypeFilter(filters.mediaType, filters.sourceKind),
    sourceKind: getEffectiveImageKind(filters),
});

export const createDefaultFilters = (
    overrides: Partial<FilterState> = {}
): FilterState => {
    const normalizedSourceKind = normalizeImageKindFilter(overrides.sourceKind);

    return {
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
        showInvokeImageAssets: false,
        sortOption: undefined,
        matchModes: undefined,
        assetFilterAliases: undefined,
        ...overrides,
        sourceKind: normalizedSourceKind,
    };
};

const hasRangeFilter = (value: number | null | undefined): boolean =>
    value !== undefined && value !== null;

export const hasNonCollectionResultFilters = (filters: FilterState): boolean => (
    filters.searchQuery.trim().length > 0 ||
    getEffectiveImageKind(filters) !== 'all' ||
    (!!filters.mediaType && filters.mediaType !== 'all') ||
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
    !!filters.showIntermediates ||
    !!filters.showGrids ||
    !!filters.showInvokeImageAssets ||
    hasRangeFilter(filters.minSteps) ||
    hasRangeFilter(filters.maxSteps) ||
    hasRangeFilter(filters.minCfg) ||
    hasRangeFilter(filters.maxCfg)
);

export const hasActiveResultFilters = (filters: FilterState): boolean => (
    hasNonCollectionResultFilters(filters) ||
    !!filters.collectionId
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
    showInvokeImageAssets: filters.showInvokeImageAssets,
    sortOption: filters.sortOption,
});

export const createCollectionSelectionFilters = (
    previousFilters: FilterState,
    collectionId: string
): FilterState => createDefaultFilters({
    ...preserveViewFilters(previousFilters),
    mediaType: 'all',
    sourceKind: 'all',
    collectionId,
});

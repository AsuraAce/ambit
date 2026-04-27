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
    ...overrides,
});

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

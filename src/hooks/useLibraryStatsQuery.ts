import { useQuery } from '@tanstack/react-query';
import { FilterState, AppSettings, Collection, FacetType } from '../types';
import { getFacets, getLibraryStats, Facets } from '../services/db/searchRepo';
import { buildSqlWhereClause } from '../utils/sqlHelpers';

interface UseLibraryStatsQueryProps {
    filters: FilterState;
    settings: AppSettings;
    privacyEnabled: boolean;
    allCollections: Collection[];
}


const INITIAL_STATS = {
    totalImages: 0,
    totalGenerations: 0,
    avgSteps: 0,
    estSizeMB: '0',
    modelStats: [],
    keywordStats: []
};

const INITIAL_FACETS: Facets = {
    checkpoints: [],
    loras: [],
    embeddings: [],
    hypernetworks: [],
    tools: []
};

export const useLibraryStatsQuery = ({
    filters,
    settings,
    privacyEnabled,
    allCollections
}: UseLibraryStatsQueryProps) => {

    // Always fetch all facet types - they're cheap from facet_cache
    const ALL_FACET_TYPES: FacetType[] = ['checkpoints', 'loras', 'embeddings', 'hypernetworks', 'tools'];

    return useQuery({
        queryKey: ['libraryStats', filters, privacyEnabled, settings.maskingMode, settings.maskedKeywords, allCollections.map(c => c.id)],
        queryFn: async () => {
            const { where, params } = buildSqlWhereClause(
                filters,
                privacyEnabled,
                settings.maskingMode,
                settings.maskedKeywords,
                allCollections
            );

            // Fetch facets and stats in parallel
            const [facets, stats] = await Promise.all([
                getFacets(where, params, ALL_FACET_TYPES),
                getLibraryStats(where, params)
            ]);

            return { facets, stats };
        },
        placeholderData: (previousData) => previousData ?? { facets: INITIAL_FACETS, stats: INITIAL_STATS },
        staleTime: 1000 * 60 * 5, // 5 minutes
    });
};

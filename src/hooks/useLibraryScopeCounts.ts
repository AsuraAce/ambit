import { useQuery } from '@tanstack/react-query';
import type { AppSettings, Collection, FilterState } from '../types';
import { countLibraryScopes } from '../services/db/searchRepo';
import { getBrowserMockScopeCounts } from '../services/browserMockData';
import { isBrowserMockMode } from '../services/runtime';
import { useLibraryStore } from '../stores/libraryStore';
import { useInvokeOwnerScopeStore } from '../stores/invokeOwnerScopeStore';
import { getInvokeOwnerQueryScopeKey } from '../utils/invokeOwnerQueryScope';
import { getEffectiveMaskedKeywords } from '../utils/maskingUtils';
import { buildSqlWhereClause } from '../utils/sqlHelpers';

interface ScopeCountsOptions {
    filters: FilterState;
    settings: AppSettings;
    privacyEnabled: boolean;
    allCollections: Collection[];
    enabled: boolean;
}

/** Optional dropdown counts never participate in gallery page readiness. */
export function useLibraryScopeCounts({ filters, settings, privacyEnabled, allCollections, enabled }: ScopeCountsOptions) {
    const facetCacheVersion = useLibraryStore(state => state.facetCacheVersion);
    const ownerScopeKey = useInvokeOwnerScopeStore(state => (
        getInvokeOwnerQueryScopeKey(settings.invokeAiPath, state.ownerScopeState)
    ));
    const keywords = getEffectiveMaskedKeywords(settings);
    const activeCollection = allCollections.find(collection => collection.id === filters.collectionId);
    const scopeQuery = buildSqlWhereClause(
        filters, privacyEnabled, settings.maskingMode, keywords, allCollections,
        false, ['sourceKind', 'mediaType']
    );

    return useQuery({
        queryKey: ['libraryStats', 'scopeCounts', facetCacheVersion,
            { ...filters, mediaType: 'all', sourceKind: 'all' },
            activeCollection?.filters ?? null, activeCollection?.manualExclusions ?? [], scopeQuery,
            privacyEnabled, settings.maskingMode, keywords, ownerScopeKey],
        queryFn: () => isBrowserMockMode()
            ? getBrowserMockScopeCounts(filters, { privacyEnabled, settings })
            : countLibraryScopes(scopeQuery.where, scopeQuery.params, scopeQuery.collectionId, scopeQuery.loraName),
        enabled,
        staleTime: 30_000,
        // No placeholder: a different query or privacy/owner scope has unknown counts.
    });
}

import { useQuery } from '@tanstack/react-query';
import type { AppSettings, FilterState } from '../types';
import { countLibraryScopes } from '../services/db/searchRepo';
import { getBrowserMockScopeAvailability } from '../services/browserMockData';
import { isBrowserMockMode } from '../services/runtime';
import { useLibraryStore } from '../stores/libraryStore';
import { useInvokeOwnerScopeStore } from '../stores/invokeOwnerScopeStore';
import { getInvokeOwnerQueryScopeKey } from '../utils/invokeOwnerQueryScope';
import { createDefaultFilters } from '../utils/filterState';
import { getEffectiveMaskedKeywords } from '../utils/maskingUtils';
import { buildSqlWhereClause } from '../utils/sqlHelpers';

interface ScopeAvailabilityOptions {
    filters: FilterState;
    settings: AppSettings;
    privacyEnabled: boolean;
    enabled: boolean;
}

/** Library-wide availability must not disappear when a search or collection is empty. */
export function useLibraryScopeAvailability({ filters, settings, privacyEnabled, enabled }: ScopeAvailabilityOptions) {
    const facetCacheVersion = useLibraryStore(state => state.facetCacheVersion);
    const ownerScopeKey = useInvokeOwnerScopeStore(state => (
        getInvokeOwnerQueryScopeKey(settings.invokeAiPath, state.ownerScopeState)
    ));
    const keywords = getEffectiveMaskedKeywords(settings);
    const libraryFilters: FilterState = {
        ...createDefaultFilters(),
        mediaType: 'all',
        sourceKind: 'all',
        showGrids: filters.showGrids,
        showIntermediates: filters.showIntermediates,
        showInvokeImageAssets: filters.showInvokeImageAssets,
    };

    return useQuery({
        queryKey: ['libraryStats', 'scopeAvailability', facetCacheVersion,
            libraryFilters.showGrids, libraryFilters.showIntermediates, libraryFilters.showInvokeImageAssets,
            privacyEnabled, settings.maskingMode, keywords, ownerScopeKey],
        queryFn: () => {
            if (isBrowserMockMode()) {
                return getBrowserMockScopeAvailability(libraryFilters, { privacyEnabled, settings });
            }
            const { where, params } = buildSqlWhereClause(
                libraryFilters, privacyEnabled, settings.maskingMode, keywords, []
            );
            return countLibraryScopes(where, params);
        },
        enabled,
        staleTime: 30_000,
        // No placeholder: neither loading nor a changed privacy/owner scope is zero availability.
    });
}

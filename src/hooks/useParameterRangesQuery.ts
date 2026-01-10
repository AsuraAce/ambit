import { useQuery } from '@tanstack/react-query';
import { commands, ParameterRanges } from '../bindings';

/**
 * Hook to fetch parameter ranges for dynamic filter UI.
 * Returns min/max for numeric parameters and distinct values for categorical ones.
 * Only shows parameters that have actual data in the database.
 */
import { useQuery } from '@tanstack/react-query';
import { commands, ParameterRanges } from '../bindings';
import { FilterState } from '../types';
import { useSettings } from '../contexts/SettingsContext';
import { useCollections } from '../contexts/CollectionContext';
import { buildSqlWhereClause } from '../utils/sqlHelpers';

/**
 * Hook to fetch parameter ranges for dynamic filter UI.
 * Returns min/max for numeric parameters and distinct values for categorical ones.
 * 
 * REACTIVE: Samplers and Generation Types respect the provided filters (drill-down).
 * GLOBAL: Steps and CFG ranges remain global (ignoring filters) for UI stability.
 */
export function useParameterRangesQuery(filters: FilterState) {
    const { settings, privacyEnabled } = useSettings();
    const { collections: allCollections } = useCollections();

    return useQuery<ParameterRanges>({
        // Refetch when filters or context changes
        queryKey: ['parameterRanges', filters, settings.maskingMode, settings.maskedKeywords, privacyEnabled, filters.collectionId],
        queryFn: async () => {
            // Build Where Clause
            const { where, params, collectionId, loraName } = buildSqlWhereClause(
                filters,
                privacyEnabled,
                settings.maskingMode,
                settings.maskedKeywords,
                allCollections
            );

            // Pass where clause, params, AND collectionId/loraName to backend
            // This ensures manual collections and single-loras are properly JOINed
            const result = await commands.getParameterRanges(
                where,
                JSON.stringify(params),
                collectionId,
                loraName
            );

            if (result.status === 'error') {
                throw new Error(result.error);
            }
            return result.data;
        },
        staleTime: 5 * 60 * 1000, // 5 minutes
        gcTime: 30 * 60 * 1000,   // 30 minutes cache
        placeholderData: (previousData) => previousData, // Smooth transitions
    });
}


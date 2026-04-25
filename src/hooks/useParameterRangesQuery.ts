import { useQuery } from '@tanstack/react-query';
import { commands, ParameterRanges } from '../bindings';
import { FilterState } from '../types';
import { useSettings } from '../contexts/SettingsContext';
import { useCollections } from '../contexts/CollectionContext';
import { buildSqlWhereClause } from '../utils/sqlHelpers';
import { isBrowserMockMode } from '../services/runtime';
import { getBrowserMockImages } from '../services/browserMockData';

/**
 * Hook to fetch parameter ranges for dynamic filter UI.
 * Returns min/max for numeric parameters and distinct values for categorical ones.
 * 
 * DISJUNCTIVE: Samplers and Generation Types exclude their OWN filter from the query
 *              to prevent self-filtering while still respecting global filters.
 * GLOBAL: Steps and CFG ranges remain global (ignoring filters) for UI stability.
 */
export function useParameterRangesQuery(filters: FilterState) {
    const { settings, privacyEnabled } = useSettings();
    const { collections: allCollections } = useCollections();
    const browserMockMode = isBrowserMockMode();

    return useQuery<ParameterRanges>({
        // Refetch when filters or context changes (exclude sampler/genType to reduce rerenders)
        queryKey: [
            'parameterRanges',
            filters.collectionId,
            filters.dateRange,
            filters.models,
            filters.tools,
            filters.loras,
            // Intentionally EXCLUDE samplers and generationTypes from query key
            // so selecting them doesn't cause a refetch (Disjunctive)
            settings.maskingMode,
            settings.maskedKeywords,
            privacyEnabled
        ],
        queryFn: async () => {
            if (browserMockMode) {
                const images = getBrowserMockImages();
                const steps = images.map(image => image.metadata.steps);
                const cfg = images.map(image => image.metadata.cfg);
                return {
                    steps: { min: Math.min(...steps), max: Math.max(...steps) },
                    cfg: { min: Math.min(...cfg), max: Math.max(...cfg) },
                    denoisingStrength: null,
                    samplers: Array.from(new Set(images.map(image => image.metadata.sampler))),
                    generationTypes: Array.from(new Set(images.map(image => image.metadata.generationType ?? 'unknown'))),
                    controlNets: Array.from(new Set(images.flatMap(image => image.metadata.controlNets ?? []))),
                    ipAdapters: Array.from(new Set(images.flatMap(image => image.metadata.ipAdapters ?? []))),
                    guidanceSubtypes: {}
                };
            }

            // Build Where Clause EXCLUDING samplers and generationTypes (Disjunctive Faceting)
            // This ensures that selecting "Euler a" doesn't hide other samplers,
            // and selecting "txt2img" doesn't hide other generation types.
            const { where, params, collectionId, loraName } = buildSqlWhereClause(
                filters,
                privacyEnabled,
                settings.maskingMode,
                settings.maskedKeywords,
                allCollections,
                false,
                ['samplers', 'generationTypes', 'controlNets', 'ipAdapters'] // Exclude these from WHERE clause
            );

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

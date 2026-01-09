
import { useState, useMemo, useEffect } from 'react';
import { AIImage, FilterState, Collection, SortOption, AppSettings } from '../types';
import { buildSqlWhereClause } from '../utils/sqlHelpers';

export const useFiltering = (
    images: AIImage[], // This will be the "Hydrated" list from Context (or empty if doing pure DB)
    collections: Collection[],
    privacyEnabled: boolean,
    maskingMode: AppSettings['maskingMode'],
    maskedKeywords: string[]
) => {
    const [filters, setFilters] = useState<FilterState>({
        searchQuery: '',
        models: [],
        tools: [],
        loras: [],
        embeddings: [],
        hypernetworks: [],
        samplers: [],
        generationTypes: [],
        dateRange: 'all',
        favoritesOnly: false,
        collectionId: null,
    });

    const [sortOption, setSortOption] = useState<SortOption>('date_desc');

    // Generate SQL Where Clause
    const { whereClause, sqlParams } = useMemo(() => {
        const { where, params } = buildSqlWhereClause(filters, privacyEnabled, maskingMode, maskedKeywords);
        return { whereClause: where, sqlParams: params };
    }, [filters, privacyEnabled, maskingMode, maskedKeywords]);

    // Available Tags (Simplification: We might need a separate DB query for this later)
    // For now, we can only compute tags from loaded images, or we disable it for 1M scale.
    // Let's keep it based on whatever `images` are passed (which might be the viewport + buffer)
    const availableTags = useMemo(() => {
        const tags = new Set<string>();
        // Only scan a subset to avoid lag
        images.slice(0, 500).forEach(img => {
            if (typeof img.metadata.positivePrompt === 'string') {
                img.metadata.positivePrompt.split(',').forEach(t => {
                    const clean = t.trim().toLowerCase();
                    if (clean.length > 2 && clean.length < 40) tags.add(clean);
                });
            }
        });
        return Array.from(tags).sort();
    }, [images]);

    const clearAllFilters = () => {
        setFilters(prev => ({
            ...prev,
            searchQuery: '',
            dateRange: 'all',
            favoritesOnly: false,
            models: [],
            tools: [],
            loras: [],
            embeddings: [],
            hypernetworks: [],
            minSteps: undefined,
            maxSteps: undefined,
            minCfg: undefined,
            maxCfg: undefined,
            collectionId: null // Clear collection too
        }));
    };

    return {
        filters,
        setFilters,
        sortOption,
        setSortOption,
        activeSqlWhere: whereClause,
        activeSqlParams: sqlParams,
        availableTags,
        clearAllFilters
    };
};
import { useEffect, useRef, useState } from 'react';
import { FilterState } from '../types';

export const SIDE_QUERY_SEARCH_DEBOUNCE_MS = 1200;

export const getNonSearchFilterFingerprint = (filters: FilterState): string => {
    const nonSearchFilters = { ...filters, searchQuery: '' };
    return JSON.stringify(nonSearchFilters);
};

/**
 * Heavy side queries should trail search typing, but structural filter changes
 * should still update immediately so filter UI stays coherent.
 */
export const useDebouncedSideQueryFilters = (
    filters: FilterState,
    delayMs: number = SIDE_QUERY_SEARCH_DEBOUNCE_MS
): FilterState => {
    const [debouncedFilters, setDebouncedFilters] = useState(filters);
    const debouncedFiltersRef = useRef(filters);

    useEffect(() => {
        const currentDebounced = debouncedFiltersRef.current;
        const currentFingerprint = getNonSearchFilterFingerprint(currentDebounced);
        const nextFingerprint = getNonSearchFilterFingerprint(filters);

        if (currentFingerprint !== nextFingerprint) {
            debouncedFiltersRef.current = filters;
            setDebouncedFilters(filters);
            return;
        }

        if (currentDebounced.searchQuery === filters.searchQuery) return;

        const timer = setTimeout(() => {
            debouncedFiltersRef.current = filters;
            setDebouncedFilters(filters);
        }, delayMs);

        return () => clearTimeout(timer);
    }, [delayMs, filters]);

    return debouncedFilters;
};

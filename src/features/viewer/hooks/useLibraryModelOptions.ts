import { useQuery } from '@tanstack/react-query';
import { getBrowserMockFacets } from '../../../services/browserMockData';
import { getFacets } from '../../../services/db/searchRepo';
import { isBrowserMockMode } from '../../../services/runtime';
import { useLibraryStore } from '../../../stores/libraryStore';

const normalizeModelOptions = (values: readonly string[]): string[] => {
    const unique = new Map<string, string>();

    for (const value of values) {
        const trimmed = value.trim();
        if (!trimmed || trimmed.toLocaleLowerCase() === 'unknown') continue;
        const key = trimmed.toLocaleLowerCase();
        if (!unique.has(key)) unique.set(key, trimmed);
    }

    return Array.from(unique.values()).sort((left, right) => left.localeCompare(right));
};
export const useLibraryModelOptions = (): string[] => {
    const facetCacheVersion = useLibraryStore(state => state.facetCacheVersion);
    const useBrowserMocks = isBrowserMockMode();
    const query = useQuery({
        queryKey: ['viewer', 'model-options', facetCacheVersion, useBrowserMocks],
        queryFn: async () => {
            const checkpoints = useBrowserMocks
                ? getBrowserMockFacets().checkpoints
                : (await getFacets('', [], ['checkpoints'], { assetScope: 'all' })).checkpoints;
            return normalizeModelOptions(checkpoints.map(item => item.name));
        },
        staleTime: 1000 * 60 * 5,
    });

    return query.data ?? [];
};

import type { QueryClient } from '@tanstack/react-query';
import { rebuildThumbnailFacetCache } from './db/imageRepo';
import { useLibraryStore } from '../stores/libraryStore';

type RefreshCollectionThumbnails = (
    debounced?: boolean,
    force?: boolean
) => Promise<void>;

interface ThumbnailConsumerRefreshOptions {
    queryClient: QueryClient;
    refreshCollectionThumbnails: RefreshCollectionThumbnails;
    logPrefix: string;
}

export const refreshThumbnailConsumers = async ({
    queryClient,
    refreshCollectionThumbnails,
    logPrefix,
}: ThumbnailConsumerRefreshOptions): Promise<void> => {
    await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['images'] }),
        queryClient.invalidateQueries({ queryKey: ['libraryStats'] }),
    ]);

    try {
        await rebuildThumbnailFacetCache();
        useLibraryStore.getState().incrementFacetCacheVersion();
    } catch (error) {
        console.warn(`${logPrefix} Thumbnail facet cache refresh failed`, error);
    }

    try {
        await refreshCollectionThumbnails(false, true);
    } catch (error) {
        console.warn(`${logPrefix} Collection thumbnail refresh failed`, error);
    }
};

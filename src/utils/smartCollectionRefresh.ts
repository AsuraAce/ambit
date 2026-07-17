import { Collection } from '../types';

export const hasPromptSearchFilter = (collection: Collection): boolean =>
    !!collection.filters?.searchQuery?.trim();

export const shouldAutoRefreshSmartCollectionSummary = (collection: Collection): boolean =>
    !!collection.filters && (!hasPromptSearchFilter(collection) || !!collection.isPinned);

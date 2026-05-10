import { describe, expect, it } from 'vitest';
import { Collection } from '../../types';
import {
    hasPromptSearchFilter,
    shouldAutoRefreshSmartCollectionSummary,
} from '../smartCollectionRefresh';
import { createDefaultFilters } from '../filterState';

const collection = (overrides: Partial<Collection>): Collection => ({
    id: 'collection-1',
    name: 'Collection',
    createdAt: 1,
    source: 'ambit',
    imageIds: [],
    count: 0,
    ...overrides,
});

describe('smartCollectionRefresh', () => {
    it('allows automatic summaries for smart collections without prompt search', () => {
        const smart = collection({
            filters: createDefaultFilters({ dateRange: 'today' }),
        });

        expect(hasPromptSearchFilter(smart)).toBe(false);
        expect(shouldAutoRefreshSmartCollectionSummary(smart)).toBe(true);
    });

    it('blocks automatic summaries for prompt-search smart collections', () => {
        const smart = collection({
            filters: createDefaultFilters({ searchQuery: 'apple' }),
        });

        expect(hasPromptSearchFilter(smart)).toBe(true);
        expect(shouldAutoRefreshSmartCollectionSummary(smart)).toBe(false);
    });

    it('does not treat static collections as automatic smart summaries', () => {
        expect(shouldAutoRefreshSmartCollectionSummary(collection({}))).toBe(false);
    });
});

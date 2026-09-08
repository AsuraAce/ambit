import { describe, expect, it } from 'vitest';
import type { Collection } from '../../types';
import { createDefaultFilters } from '../filterState';
import { compareCollectionsByCount, getCollectionCount } from '../collectionCount';

const collection = (overrides: Partial<Collection> = {}): Collection => ({
    id: 'collection',
    name: 'Collection',
    imageIds: [],
    createdAt: 1,
    source: 'ambit',
    ...overrides
});

describe('collection count semantics', () => {
    it.each(['pending', 'failed'] as const)('does not infer membership or use old values for %s counts', countState => {
        expect(getCollectionCount(collection({ countState, count: 9, imageIds: ['one'] }))).toBeUndefined();
        expect(getCollectionCount(collection({ countState }))).toBeUndefined();
    });

    it.each(['asc', 'desc'] as const)('stably sorts pending and failed ordinary counts last for %s', direction => {
        const rows = [collection({ id: 'pending', countState: 'pending' }),
            collection({ id: 'failed', countState: 'failed' }), collection({ id: 'zero', count: 0 })];
        expect(rows.sort((a, b) => compareCollectionsByCount(a, b, direction)).map(row => row.id))
            .toEqual(['zero', 'pending', 'failed']);
    });
    it('uses a verified count, including zero, before any fallback', () => {
        expect(getCollectionCount(collection({ count: 0, imageIds: ['one'] }))).toBe(0);
        expect(getCollectionCount(collection({ count: 3, imageIds: [] }))).toBe(3);
    });

    it('falls back to membership only for static collections', () => {
        expect(getCollectionCount(collection({ imageIds: ['one', 'two'] }))).toBe(2);
        expect(getCollectionCount(collection({
            imageIds: ['one', 'two'],
            filters: createDefaultFilters()
        }))).toBeUndefined();
    });

    it.each([
        ['asc', ['empty', 'populated', 'unknown']],
        ['desc', ['populated', 'empty', 'unknown']]
    ] as const)('sorts unknown counts last for %s order', (direction, expectedIds) => {
        const collections = [
            collection({ id: 'unknown', filters: createDefaultFilters() }),
            collection({ id: 'populated', count: 5 }),
            collection({ id: 'empty', count: 0 })
        ];

        expect(collections.sort((a, b) => compareCollectionsByCount(a, b, direction)).map(item => item.id))
            .toEqual(expectedIds);
    });
});

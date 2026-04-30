import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FilterState } from '../../../types';
import { parsePersistedCollectionFilters, upsertCollection } from '../collectionRepo';

const dbMocks = vi.hoisted(() => ({
    execute: vi.fn(),
    getDb: vi.fn(),
    dispatch: vi.fn(async (fn: () => Promise<unknown>) => fn()),
}));

vi.mock('@tauri-apps/api/core', () => ({
    convertFileSrc: (path: string) => `asset://${path}`,
}));

vi.mock('../../runtime', () => ({
    isBrowserMockMode: () => false,
}));

vi.mock('../connection', () => ({
    dbMutex: {
        dispatch: dbMocks.dispatch,
    },
    getDb: dbMocks.getDb,
}));

describe('collectionRepo filter normalization', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        dbMocks.execute.mockResolvedValue(undefined);
        dbMocks.getDb.mockResolvedValue({ execute: dbMocks.execute });
    });

    it('normalizes legacy persisted collection filters with current defaults', () => {
        const filters = parsePersistedCollectionFilters(JSON.stringify({
            searchQuery: 'portrait',
            loras: ['detail'],
        }));

        expect(filters).toMatchObject({
            searchQuery: 'portrait',
            loras: ['detail'],
            controlNets: [],
            ipAdapters: [],
            pinnedOnly: false,
            showIntermediates: false,
            showGrids: false,
            collectionId: null,
        });
    });

    it('serializes smart collection filters with current defaults', async () => {
        await upsertCollection({
            id: 'smart-a',
            name: 'Smart A',
            filters: { searchQuery: 'portrait' } as unknown as FilterState,
        });

        const calls = dbMocks.execute.mock.calls as Array<[string, unknown[]]>;
        const params = calls[0][1];
        const serializedFilters = params[6];

        expect(typeof serializedFilters).toBe('string');
        const filters = parsePersistedCollectionFilters(serializedFilters as string);
        expect(filters?.searchQuery).toBe('portrait');
        expect(filters?.controlNets).toEqual([]);
        expect(filters?.ipAdapters).toEqual([]);
        expect(filters?.pinnedOnly).toBe(false);
    });
});

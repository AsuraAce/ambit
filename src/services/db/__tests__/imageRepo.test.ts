import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
    convertFileSrc: (path: string) => `asset://${path}`,
}));

vi.mock('../../../bindings', () => ({
    commands: {
        saveImagesBatch: vi.fn(),
        moveToTrash: vi.fn(),
        deleteThumbnail: vi.fn(),
        rebuildFacetCache: vi.fn(),
        rebuildFacetCacheIncremental: vi.fn(),
    }
}));

const dispatchMock = vi.fn(async (fn: () => Promise<unknown>) => fn());
const getDbMock = vi.fn();

vi.mock('../connection', () => ({
    dbMutex: {
        dispatch: (...args: unknown[]) => dispatchMock(...args as [() => Promise<unknown>]),
    },
    getDb: () => getDbMock(),
}));

describe('imageRepo batch removal', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('chunks multi-image library removal so large selections do not exceed sqlite parameter limits', async () => {
        const ids = Array.from({ length: 1001 }, (_, index) => `C:/images/${index}.png`);
        const imageRowsById = new Map(ids.map((id, index) => [id, {
            id,
            path: id,
            width: 512,
            height: 512,
            file_size: 1024 + index,
            timestamp: 1700000000000 + index,
            metadata_json: JSON.stringify({ model: 'test', tool: 'ComfyUI' }),
            thumbnail_path: `C:/thumbs/${index}.webp`,
            micro_thumbnail: null,
            thumbnail_source: 'ambit',
            is_favorite: 0,
            is_pinned: 0,
            is_missing: 0,
            user_masked: null,
            group_id: null,
            board_id: null,
            notes: null,
            original_metadata_json: null,
            original_parsed_json: null,
            original_state_json: null,
            is_corrupt: 0,
        }]));
        const membershipRowsById = new Map(ids.map(id => [id, [{ image_id: id, collection_id: 'collection-a' }]]));
        const removedRows = new Map<string, { id: string; collectionIdsJson: string | null }>();
        const deletedImageIds = new Set<string>();

        const enforceParamLimit = (params: unknown[] = []) => {
            if (params.length > 900) {
                throw new Error(`too many SQL variables: ${params.length}`);
            }
        };

        const db = {
            select: vi.fn(async (sql: string, params: string[] = []) => {
                enforceParamLimit(params);
                if (sql.includes('FROM images')) {
                    return params.map(id => imageRowsById.get(id)).filter(Boolean);
                }
                if (sql.includes('FROM collection_images')) {
                    return params.flatMap(id => membershipRowsById.get(id) ?? []);
                }
                return [];
            }),
            execute: vi.fn(async (sql: string, params: unknown[] = []) => {
                enforceParamLimit(params);

                if (sql.includes('INSERT OR REPLACE INTO removed_images')) {
                    removedRows.set(params[0] as string, {
                        id: params[0] as string,
                        collectionIdsJson: (params[22] as string | null) ?? null,
                    });
                    return;
                }

                if (sql.startsWith('DELETE FROM images WHERE id IN')) {
                    for (const id of params as string[]) {
                        deletedImageIds.add(id);
                    }
                }
            }),
        };

        getDbMock.mockResolvedValue(db);

        const { removeImagesFromLibrary } = await import('../imageRepo');

        await expect(removeImagesFromLibrary(ids)).resolves.toBeUndefined();

        expect(dispatchMock).toHaveBeenCalledTimes(1);
        expect(removedRows.size).toBe(ids.length);
        expect(deletedImageIds.size).toBe(ids.length);
        expect(db.select).toHaveBeenCalled();
        expect(db.execute).toHaveBeenCalled();

        const allSelectParamCounts = db.select.mock.calls.map(([, params]) => (params as unknown[] | undefined)?.length ?? 0);
        const allExecuteParamCounts = db.execute.mock.calls.map(([, params]) => (params as unknown[] | undefined)?.length ?? 0);
        expect(Math.max(...allSelectParamCounts)).toBeLessThanOrEqual(900);
        expect(Math.max(...allExecuteParamCounts)).toBeLessThanOrEqual(900);
        expect(removedRows.get(ids[0])?.collectionIdsJson).toBe(JSON.stringify(['collection-a']));
    });
});

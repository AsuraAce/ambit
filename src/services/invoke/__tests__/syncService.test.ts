import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from '@tauri-apps/plugin-sql';
import { commands } from '../../../bindings';
import { fetchBoardMappings } from '../connection';
import { insertImagesBatch } from '../../db';
import { upsertCollection } from '../../db/collectionRepo';
import { getImagesByIds, syncCollectionImages } from '../../db/imageRepo';
import { syncImages } from '../syncService';

vi.mock('@tauri-apps/plugin-sql', () => ({
    default: {
        load: vi.fn()
    }
}));

vi.mock('@tauri-apps/api/core', () => ({
    convertFileSrc: vi.fn((path: string) => `asset://${path}`)
}));

vi.mock('../../../bindings', () => ({
    commands: {
        getFileSizesBulk: vi.fn()
    }
}));

vi.mock('../metadataMapper', () => ({
    mapInvokeMetadata: vi.fn(() => ({
        tool: 'invokeai',
        model: 'Test Model',
        seed: 1,
        steps: 20,
        cfg: 7,
        sampler: 'Euler',
        positivePrompt: 'test',
        negativePrompt: '',
        generationType: 'txt2img'
    }))
}));

vi.mock('../connection', () => ({
    fetchBoardMappings: vi.fn()
}));

vi.mock('../../db', () => ({
    insertImagesBatch: vi.fn()
}));

vi.mock('../../db/imageRepo', () => ({
    getImagesByIds: vi.fn(),
    syncCollectionImages: vi.fn()
}));

vi.mock('../../db/collectionRepo', () => ({
    upsertCollection: vi.fn()
}));

const createInvokeDb = (selectMock: ReturnType<typeof vi.fn>) => ({
    select: selectMock
});

describe('syncImages live mode', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(commands.getFileSizesBulk).mockResolvedValue({ status: 'ok', data: [123] } as never);
        vi.mocked(insertImagesBatch).mockResolvedValue(undefined as never);
        vi.mocked(getImagesByIds).mockResolvedValue([]);
        vi.mocked(syncCollectionImages).mockResolvedValue(undefined as never);
        vi.mocked(upsertCollection).mockResolvedValue(undefined as never);
        vi.mocked(fetchBoardMappings).mockResolvedValue({
            imageToBoardId: new Map(),
            boards: new Map()
        });
    });

    it('returns early for no-op live cycles before board and collection sync work', async () => {
        const selectMock = vi.fn(async (query: string) => {
            if (query.includes('PRAGMA table_info(images)')) {
                return [{ name: 'metadata_json' }, { name: 'updated_at' }, { name: 'is_intermediate' }];
            }
            if (query.includes("SELECT name FROM sqlite_master WHERE type='table'")) {
                return [{ name: 'images' }];
            }
            if (query.includes('SELECT 1 as found FROM images i')) {
                return [];
            }
            throw new Error(`Unexpected query: ${query}`);
        });

        vi.mocked(Database.load).mockResolvedValue(createInvokeDb(selectMock) as never);

        const result = await syncImages(
            'D:/AI/art/webUI/invokeai/databases',
            vi.fn(),
            undefined,
            {
                mode: 'live',
                syncBoards: true,
                syncFavorites: true,
                starredAs: 'favorite'
            }
        );

        expect(result.imported).toBe(0);
        expect(result.updated).toBe(0);
        expect(fetchBoardMappings).not.toHaveBeenCalled();
        expect(getImagesByIds).not.toHaveBeenCalled();
        expect(insertImagesBatch).not.toHaveBeenCalled();
        expect(syncCollectionImages).not.toHaveBeenCalled();
        expect(upsertCollection).not.toHaveBeenCalled();
    });

    it('returns early for no-op startup cycles after candidate detection without counting', async () => {
        const selectMock = vi.fn(async (query: string) => {
            if (query.includes('PRAGMA table_info(images)')) {
                return [{ name: 'metadata_json' }, { name: 'updated_at' }, { name: 'is_intermediate' }];
            }
            if (query.includes("SELECT name FROM sqlite_master WHERE type='table'")) {
                return [{ name: 'images' }];
            }
            if (query.includes('SELECT 1 as found FROM images i')) {
                return [];
            }
            throw new Error(`Unexpected query: ${query}`);
        });

        vi.mocked(Database.load).mockResolvedValue(createInvokeDb(selectMock) as never);

        const result = await syncImages(
            'D:/AI/art/webUI/invokeai/databases',
            vi.fn(),
            undefined,
            {
                mode: 'startup',
                afterTimestamp: 100,
                syncBoards: true,
                syncFavorites: true,
                starredAs: 'favorite'
            }
        );

        expect(result.imported).toBe(0);
        expect(result.updated).toBe(0);
        expect(selectMock).not.toHaveBeenCalledWith(expect.stringContaining('SELECT count(*) as count FROM images i'));
        expect(fetchBoardMappings).not.toHaveBeenCalled();
        expect(getImagesByIds).not.toHaveBeenCalled();
        expect(insertImagesBatch).not.toHaveBeenCalled();
    });

    it('keeps live changed cycles incremental and skips the final full collection sync', async () => {
        const selectMock = vi.fn(async (query: string) => {
            if (query.includes('PRAGMA table_info(images)')) {
                return [
                    { name: 'metadata_json' },
                    { name: 'updated_at' },
                    { name: 'is_intermediate' },
                    { name: 'starred' },
                    { name: 'thumbnail_name' },
                    { name: 'has_workflow' }
                ];
            }
            if (query.includes("SELECT name FROM sqlite_master WHERE type='table'")) {
                return [{ name: 'images' }, { name: 'boards' }];
            }
            if (query.includes('SELECT 1 as found FROM images i')) {
                return [{ found: 1 }];
            }
            if (query.includes('SELECT count(*) as count FROM images i')) {
                return [{ count: 1 }];
            }
            if (query.includes("SELECT name FROM sqlite_master WHERE type='table' AND name='boards'")) {
                return [{ name: 'boards' }];
            }
            if (query.includes('FROM images i') && query.includes('OFFSET 0')) {
                return [
                    {
                        image_name: 'new-image.png',
                        metadata_blob: { positive_prompt: 'test' },
                        created_at: '2026-04-18 12:00:00',
                        updated_at: '2026-04-18 12:00:05',
                        width: 1024,
                        height: 1024,
                        starred: 1,
                        thumbnail_name: 'new-image.webp',
                        has_workflow: 1,
                        is_intermediate: 0
                    }
                ];
            }
            return [];
        });

        vi.mocked(Database.load).mockResolvedValue(createInvokeDb(selectMock) as never);
        vi.mocked(fetchBoardMappings).mockResolvedValue({
            imageToBoardId: new Map([['new-image.png', 'board-1']]),
            boards: new Map([['board-1', { name: 'Board One', createdAt: 123 }]])
        });

        const result = await syncImages(
            'D:/AI/art/webUI/invokeai/databases',
            vi.fn(),
            undefined,
            {
                mode: 'live',
                syncBoards: true,
                syncFavorites: true,
                starredAs: 'both'
            }
        );

        expect(result.imported).toBe(1);
        expect(insertImagesBatch).toHaveBeenCalledTimes(1);
        expect(syncCollectionImages).toHaveBeenCalledTimes(1);
        expect(syncCollectionImages).toHaveBeenCalledWith([
            'D:/AI/art/webUI/invokeai/outputs/images/new-image.png'
        ]);
        expect(upsertCollection).toHaveBeenCalledTimes(1);
    });
});
